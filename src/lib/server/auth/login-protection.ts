import { createHash } from "node:crypto";
import { and, count, eq, gt, lte, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AdminSecurityConfig } from "@/lib/config/config";
import { getDb, getSql } from "../db";
import { adminLoginAttempts } from "../db-schema";
import { serverEnv } from "../env";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const turnstileVerifyResponseSchema = z.object({
  "error-codes": z.array(z.string()).optional(),
  success: z.boolean(),
});

let schemaReadyPromise: Promise<void> | undefined;

type LoginProtectionConfig = {
  challengeAfterFailures: number;
  challengeMode: "off" | "always" | "after_failures";
  emailFailureLimit: number;
  emailIpFailureLimit: number;
  failureDelayMs: number;
  ipDailyFailureLimit: number;
  ipFailureLimit: number;
  lockoutMs: number;
  throttleEnabled: boolean;
  turnstileSecretKey?: string;
  turnstileSiteKey?: string;
  windowMs: number;
};

type LoginAttemptKeys = {
  clientIp?: string;
  clientIpHash?: string;
  emailHash?: string;
  emailIpHash?: string;
};

export type AdminLoginChallengeUiConfig =
  | {
      mode: "off";
      provider: "none";
      siteKey: null;
    }
  | {
      mode: "always" | "after_failures";
      provider: "turnstile";
      siteKey: string | null;
    };

export type AdminLoginProtectionCheck =
  | {
      keys: LoginAttemptKeys;
      ok: true;
    }
  | {
      challengeRequired?: boolean;
      error: string;
      keys: LoginAttemptKeys;
      ok: false;
    };

function getLoginProtectionConfig(
  adminSecurity: AdminSecurityConfig,
): LoginProtectionConfig {
  return {
    challengeAfterFailures: adminSecurity.loginChallenge.afterFailures,
    challengeMode: adminSecurity.loginChallenge.mode,
    emailFailureLimit: adminSecurity.loginThrottle.maxEmailFailures,
    emailIpFailureLimit: adminSecurity.loginThrottle.maxEmailIpFailures,
    failureDelayMs:
      process.env.NODE_ENV === "test"
        ? 0
        : adminSecurity.loginThrottle.failureDelayMs,
    ipDailyFailureLimit: adminSecurity.loginThrottle.maxIpDailyFailures,
    ipFailureLimit: adminSecurity.loginThrottle.maxIpFailures,
    lockoutMs: adminSecurity.loginThrottle.lockoutMinutes * 60 * 1000,
    throttleEnabled: adminSecurity.loginThrottle.enabled,
    turnstileSecretKey: serverEnv.ADMIN_TURNSTILE_SECRET_KEY,
    turnstileSiteKey: serverEnv.ADMIN_TURNSTILE_SITE_KEY,
    windowMs: adminSecurity.loginThrottle.windowMinutes * 60 * 1000,
  };
}

export function getAdminLoginChallengeUiConfig(
  adminSecurity: AdminSecurityConfig,
): AdminLoginChallengeUiConfig {
  const config = getLoginProtectionConfig(adminSecurity);

  if (config.challengeMode === "off") {
    return {
      mode: "off",
      provider: "none",
      siteKey: null,
    };
  }

  return {
    mode: config.challengeMode,
    provider: "turnstile",
    siteKey: config.turnstileSiteKey ?? null,
  };
}

async function ensureLoginProtectionSchema(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const sql = getSql();

      await sql`
        create table if not exists admin_login_attempts (
          id integer primary key generated always as identity,
          client_ip_hash text,
          email_hash text,
          email_ip_hash text,
          occurred_at timestamptz not null default now(),
          reason text not null
        )
      `;

      await sql`
        create index if not exists admin_login_attempts_client_ip_idx
        on admin_login_attempts (client_ip_hash, occurred_at)
      `;

      await sql`
        create index if not exists admin_login_attempts_email_idx
        on admin_login_attempts (email_hash, occurred_at)
      `;

      await sql`
        create index if not exists admin_login_attempts_email_ip_idx
        on admin_login_attempts (email_ip_hash, occurred_at)
      `;

      await sql`
        create index if not exists admin_login_attempts_occurred_at_idx
        on admin_login_attempts (occurred_at)
      `;
    })().catch((error) => {
      schemaReadyPromise = undefined;
      throw error;
    });
  }

  await schemaReadyPromise;
}

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function normalizeIdentifier(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function sanitizeClientIp(value: string | null): string | undefined {
  const ip = value?.split(",")[0]?.trim();

  if (!ip || ip.length > 128) {
    return undefined;
  }

  return /^[a-zA-Z0-9:._%-]+$/.test(ip) ? ip : undefined;
}

function getTrustedClientIp(request: Request | undefined): string | undefined {
  const headerName = serverEnv.ADMIN_LOGIN_IP_HEADER?.trim().toLowerCase();

  if (!request || !headerName || !/^[a-z0-9-]+$/.test(headerName)) {
    return undefined;
  }

  return sanitizeClientIp(request.headers.get(headerName));
}

function buildAttemptKeys(
  email: string,
  request: Request | undefined,
): LoginAttemptKeys {
  const emailIdentifier = normalizeIdentifier(email);
  const clientIp = getTrustedClientIp(request);
  const emailHash = emailIdentifier
    ? hashIdentifier(`admin-login-email:${emailIdentifier}`)
    : undefined;
  const clientIpHash = clientIp
    ? hashIdentifier(`admin-login-ip:${clientIp}`)
    : undefined;
  const emailIpHash =
    emailIdentifier && clientIp
      ? hashIdentifier(`admin-login-email-ip:${emailIdentifier}:${clientIp}`)
      : undefined;

  return {
    clientIp,
    clientIpHash,
    emailHash,
    emailIpHash,
  };
}

async function cleanupOldAttempts(
  config: LoginProtectionConfig,
): Promise<void> {
  const retentionMs = Math.max(ONE_DAY_MS, config.windowMs + config.lockoutMs);
  await getDb()
    .delete(adminLoginAttempts)
    .where(
      lte(adminLoginAttempts.occurredAt, new Date(Date.now() - retentionMs)),
    );
}

async function countFailures(where: SQL | undefined): Promise<number> {
  if (!where) {
    return 0;
  }

  const [row] = await getDb()
    .select({ value: count() })
    .from(adminLoginAttempts)
    .where(where);

  return row?.value ?? 0;
}

async function getFailureCounts(
  keys: LoginAttemptKeys,
  config: LoginProtectionConfig,
) {
  const windowStart = new Date(Date.now() - config.windowMs);
  const dailyStart = new Date(Date.now() - ONE_DAY_MS);

  const [emailFailures, emailIpFailures, ipFailures, ipDailyFailures] =
    await Promise.all([
      countFailures(
        keys.emailHash
          ? and(
              eq(adminLoginAttempts.emailHash, keys.emailHash),
              gt(adminLoginAttempts.occurredAt, windowStart),
            )
          : undefined,
      ),
      countFailures(
        keys.emailIpHash
          ? and(
              eq(adminLoginAttempts.emailIpHash, keys.emailIpHash),
              gt(adminLoginAttempts.occurredAt, windowStart),
            )
          : undefined,
      ),
      countFailures(
        keys.clientIpHash
          ? and(
              eq(adminLoginAttempts.clientIpHash, keys.clientIpHash),
              gt(adminLoginAttempts.occurredAt, windowStart),
            )
          : undefined,
      ),
      countFailures(
        keys.clientIpHash
          ? and(
              eq(adminLoginAttempts.clientIpHash, keys.clientIpHash),
              gt(adminLoginAttempts.occurredAt, dailyStart),
            )
          : undefined,
      ),
    ]);

  return {
    emailFailures,
    emailIpFailures,
    ipDailyFailures,
    ipFailures,
  };
}

async function verifyTurnstileChallenge({
  clientIp,
  config,
  token,
}: {
  clientIp?: string;
  config: LoginProtectionConfig;
  token: string | undefined;
}): Promise<{ error?: string; ok: boolean }> {
  if (!config.turnstileSecretKey) {
    return {
      error:
        "Admin login challenge is enabled, but ADMIN_TURNSTILE_SECRET_KEY is not configured.",
      ok: false,
    };
  }

  if (!token) {
    return {
      error: "Complete the login challenge and try again.",
      ok: false,
    };
  }

  const body = new URLSearchParams({
    response: token,
    secret: config.turnstileSecretKey,
  });

  if (clientIp) {
    body.set("remoteip", clientIp);
  }

  try {
    const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      body,
      method: "POST",
    });
    const parsed = turnstileVerifyResponseSchema.safeParse(
      await response.json(),
    );

    if (!response.ok || !parsed.success || !parsed.data.success) {
      return {
        error: "The login challenge could not be verified.",
        ok: false,
      };
    }

    return { ok: true };
  } catch {
    return {
      error: "The login challenge could not be verified.",
      ok: false,
    };
  }
}

export async function checkAdminLoginProtection({
  adminSecurity,
  challengeToken,
  email,
  request,
}: {
  adminSecurity: AdminSecurityConfig;
  challengeToken?: string;
  email: string;
  request?: Request;
}): Promise<AdminLoginProtectionCheck> {
  const keys = buildAttemptKeys(email, request);

  if (!serverEnv.DATABASE_URL) {
    return { keys, ok: true };
  }

  const config = getLoginProtectionConfig(adminSecurity);
  await ensureLoginProtectionSchema();
  await cleanupOldAttempts(config);

  const failures = await getFailureCounts(keys, config);
  const challengeRequired =
    config.challengeMode === "always" ||
    (config.challengeMode === "after_failures" &&
      Math.max(
        failures.emailFailures,
        failures.emailIpFailures,
        failures.ipFailures,
      ) >= config.challengeAfterFailures);

  const lockedOut =
    config.throttleEnabled &&
    (failures.emailFailures >= config.emailFailureLimit ||
      failures.emailIpFailures >= config.emailIpFailureLimit ||
      failures.ipFailures >= config.ipFailureLimit ||
      failures.ipDailyFailures >= config.ipDailyFailureLimit);

  if (lockedOut) {
    return {
      error: "Too many login attempts. Wait a while and try again.",
      keys,
      ok: false,
    };
  }

  if (challengeRequired) {
    const challenge = await verifyTurnstileChallenge({
      clientIp: keys.clientIp,
      config,
      token: challengeToken,
    });

    if (!challenge.ok) {
      return {
        challengeRequired: true,
        error: challenge.error ?? "Complete the login challenge and try again.",
        keys,
        ok: false,
      };
    }
  }

  return { keys, ok: true };
}

export async function recordAdminLoginFailure({
  email,
  keys,
  reason,
  request,
}: {
  email: string;
  keys?: LoginAttemptKeys;
  reason: string;
  request?: Request;
}): Promise<void> {
  if (!serverEnv.DATABASE_URL) {
    return;
  }

  const resolvedKeys = keys ?? buildAttemptKeys(email, request);

  if (
    !resolvedKeys.clientIpHash &&
    !resolvedKeys.emailHash &&
    !resolvedKeys.emailIpHash
  ) {
    return;
  }

  await ensureLoginProtectionSchema();
  await getDb().insert(adminLoginAttempts).values({
    clientIpHash: resolvedKeys.clientIpHash,
    emailHash: resolvedKeys.emailHash,
    emailIpHash: resolvedKeys.emailIpHash,
    reason,
  });
}

export async function clearAdminLoginFailures({
  email,
  keys,
  request,
}: {
  email: string;
  keys?: LoginAttemptKeys;
  request?: Request;
}): Promise<void> {
  if (!serverEnv.DATABASE_URL) {
    return;
  }

  const resolvedKeys = keys ?? buildAttemptKeys(email, request);
  const where = or(
    resolvedKeys.emailHash
      ? eq(adminLoginAttempts.emailHash, resolvedKeys.emailHash)
      : undefined,
    resolvedKeys.emailIpHash
      ? eq(adminLoginAttempts.emailIpHash, resolvedKeys.emailIpHash)
      : undefined,
  );

  if (!where) {
    return;
  }

  await ensureLoginProtectionSchema();
  await getDb().delete(adminLoginAttempts).where(where);
}

export async function delayAfterFailedAdminLogin(
  adminSecurity: AdminSecurityConfig,
): Promise<void> {
  const delayMs = getLoginProtectionConfig(adminSecurity).failureDelayMs;

  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
