import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { googleCalendarConnection as connection } from "./db-schema";
import {
  GOOGLE_CALENDAR_SCOPE,
  type GoogleOAuthSettings,
  googleEventsUrl,
  googleFetch,
} from "./google-calendar-settings";

const tokenUrl = "https://oauth2.googleapis.com/token";
const connectionId = 1;
const clearState = {
  stateHash: null,
  sessionHash: null,
  pkceVerifier: null,
  siteId: null,
  stateExpiresAt: null,
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function sealGoogleToken(
  value: string,
  settings: GoogleOAuthSettings,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", settings.key, iv);
  cipher.setAAD(Buffer.from(settings.clientId));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url",
  );
}

export function openGoogleToken(
  packed: string,
  settings: GoogleOAuthSettings,
): string {
  const value = Buffer.from(packed, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    settings.key,
    value.subarray(0, 12),
  );
  decipher.setAAD(Buffer.from(settings.clientId));
  decipher.setAuthTag(value.subarray(12, 28));
  return Buffer.concat([
    decipher.update(value.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}

async function readConnection() {
  const [row] = await getDb()
    .select({
      clientId: connection.clientId,
      encryptedRefreshToken: connection.encryptedRefreshToken,
    })
    .from(connection)
    .where(eq(connection.id, connectionId));
  return row;
}

export async function getGoogleConnectionStatus(settings: GoogleOAuthSettings) {
  const row = await readConnection();
  if (!row?.clientId) return "disconnected" as const;
  if (row.clientId === settings.clientId && row.encryptedRefreshToken) {
    try {
      openGoogleToken(row.encryptedRefreshToken, settings);
      return "connected" as const;
    } catch {
      return "reconnect" as const;
    }
  }
  return "reconnect" as const;
}

export function makeGoogleAuthorization(
  settings: GoogleOAuthSettings,
  sessionToken: string,
  siteId: string,
  now = Date.now(),
) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: settings.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: digest(verifier),
    code_challenge_method: "S256",
  }).toString();
  return {
    url,
    attempt: {
      revision: randomUUID(),
      siteId,
      stateHash: digest(state),
      sessionHash: digest(sessionToken),
      pkceVerifier: sealGoogleToken(verifier, settings),
      stateExpiresAt: new Date(now + 10 * 60_000),
    },
  };
}

export async function startGoogleConnection(
  settings: GoogleOAuthSettings,
  sessionToken: string,
  siteId: string,
) {
  const { url, attempt } = makeGoogleAuthorization(
    settings,
    sessionToken,
    siteId,
  );
  await getDb()
    .insert(connection)
    .values({ id: connectionId, ...attempt })
    .onConflictDoUpdate({ target: connection.id, set: attempt });
  return url;
}

export async function claimGoogleOAuthState(
  state: string,
  sessionToken: string,
) {
  const db = getDb();
  const matchesAttempt = () =>
    and(
      eq(connection.id, connectionId),
      eq(connection.stateHash, digest(state)),
      eq(connection.sessionHash, digest(sessionToken)),
      gt(connection.stateExpiresAt, new Date()),
    );
  const [attempt] = await db
    .select({
      revision: connection.revision,
      pkceVerifier: connection.pkceVerifier,
      siteId: connection.siteId,
    })
    .from(connection)
    .where(matchesAttempt());
  if (!attempt?.pkceVerifier || !attempt.siteId) return null;

  const [claimed] = await db
    .update(connection)
    .set(clearState)
    .where(and(matchesAttempt(), eq(connection.revision, attempt.revision)))
    .returning({ id: connection.id });
  return claimed
    ? { ...attempt, pkceVerifier: attempt.pkceVerifier, siteId: attempt.siteId }
    : null;
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

async function requestToken(
  settings: GoogleOAuthSettings,
  params: Record<string, string>,
) {
  const response = await googleFetch(tokenUrl, {
    method: "POST",
    body: new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      ...params,
    }),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(data);
    if (response.status === 400 && error.data?.error === "invalid_grant") {
      return null;
    }
    throw new Error("Google token request failed.");
  }

  return tokenResponse.parse(data);
}

export async function finishGoogleConnection(
  settings: GoogleOAuthSettings,
  attempt: { revision: string; pkceVerifier: string },
  code: string,
  calendarId: string,
) {
  const tokens = await requestToken(settings, {
    grant_type: "authorization_code",
    redirect_uri: settings.redirectUri,
    code,
    code_verifier: openGoogleToken(attempt.pkceVerifier, settings),
  });
  if (
    !tokens?.refresh_token ||
    !tokens.scope?.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE)
  ) {
    return "consent_required" as const;
  }

  const url = googleEventsUrl(calendarId);
  url.search = new URLSearchParams({
    maxResults: "1",
    fields: "accessRole",
  }).toString();
  const response = await googleFetch(url, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (response.status === 403 || response.status === 404) {
    return "calendar_access" as const;
  }
  if (!response.ok) throw new Error("Google calendar access check failed.");
  const { accessRole } = z
    .object({ accessRole: z.string() })
    .parse(await response.json());
  if (accessRole !== "owner") return "calendar_access" as const;

  const [saved] = await getDb()
    .update(connection)
    .set({
      clientId: settings.clientId,
      encryptedRefreshToken: sealGoogleToken(tokens.refresh_token, settings),
    })
    .where(
      and(
        eq(connection.id, connectionId),
        eq(connection.revision, attempt.revision),
      ),
    )
    .returning({ id: connection.id });
  return saved ? ("connected" as const) : ("superseded" as const);
}

export async function getGoogleAccessToken(settings: GoogleOAuthSettings) {
  const row = await readConnection();
  if (row?.clientId !== settings.clientId || !row.encryptedRefreshToken)
    return null;

  let refreshToken: string;
  try {
    refreshToken = openGoogleToken(row.encryptedRefreshToken, settings);
  } catch {
    return null;
  }

  const tokens = await requestToken(settings, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  if (!tokens || tokens.refresh_token) {
    await getDb()
      .update(connection)
      .set({
        encryptedRefreshToken: tokens?.refresh_token
          ? sealGoogleToken(tokens.refresh_token, settings)
          : null,
      })
      .where(
        and(
          eq(connection.id, connectionId),
          eq(connection.encryptedRefreshToken, row.encryptedRefreshToken),
        ),
      );
  }
  return tokens?.access_token ?? null;
}

export async function disconnectGoogleCalendar(settings: GoogleOAuthSettings) {
  const [row] = await getDb()
    .delete(connection)
    .where(eq(connection.id, connectionId))
    .returning({
      clientId: connection.clientId,
      encryptedRefreshToken: connection.encryptedRefreshToken,
    });
  if (!row?.encryptedRefreshToken) return true;
  if (row.clientId !== settings.clientId) return false;

  try {
    const response = await googleFetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      body: new URLSearchParams({
        token: openGoogleToken(row.encryptedRefreshToken, settings),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
