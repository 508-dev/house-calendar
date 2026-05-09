import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import type { AdminSecurityConfig } from "@/lib/config/config";
import { getDb, getSql } from "../db";
import { adminBootstrapCodes, adminSessions, adminUsers } from "../db-schema";
import { serverEnv } from "../env";
import { appendSetCookie, readCookie, serializeCookie } from "../http-cookies";
import {
  generateBootstrapCode,
  getBootstrapCodeExpiry,
  hashBootstrapCode,
} from "./bootstrap-code";
import {
  checkAdminLoginProtection,
  clearAdminLoginFailures,
  delayAfterFailedAdminLogin,
  recordAdminLoginFailure,
} from "./login-protection";
import { hashPassword, verifyPassword } from "./password";

const ADMIN_SESSION_COOKIE = "house_calendar_admin_session";
const ADMIN_SESSION_DURATION_DAYS = 30;
const ADMIN_PASSWORD_MIN_LENGTH = 10;
const DUMMY_PASSWORD_HASH = hashPassword(
  "house-calendar dummy password for login timing",
);
const DEV_BOOTSTRAP_DISABLED_MESSAGE =
  "Development admin bootstrap is disabled in production.";

const setupInputSchema = z.object({
  bootstrapCode: z.string().min(1),
  email: z.string().trim().email(),
  password: z.string().min(ADMIN_PASSWORD_MIN_LENGTH),
});

const loginInputSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const directSetupInputSchema = loginInputSchema.extend({
  password: z.string().min(ADMIN_PASSWORD_MIN_LENGTH),
});

export type AdminSession = {
  email: string;
  expiresAt: Date;
  token: string;
  userId: number;
};

export type CurrentAdminSession = Omit<AdminSession, "token">;

type AdminAuthState = {
  adminEmail: string | null;
  bootstrapCodeReady: boolean;
  databaseConfigured: boolean;
  initialized: boolean;
  session: CurrentAdminSession | null;
};

type AuthActionResult =
  | {
      challengeRequired?: boolean;
      error: string;
      ok: false;
    }
  | {
      ok: true;
      session: AdminSession;
    };

type DirectBootstrapResult =
  | {
      error: string;
      ok: false;
    }
  | {
      created: boolean;
      email: string;
      ok: true;
    };

type AdminPasswordResetResult =
  | {
      error: string;
      ok: false;
    }
  | {
      email: string;
      ok: true;
      revokedSessionCount: number;
    };

type AuthDb = ReturnType<typeof getDb>;
type AuthDbWriter = Pick<AuthDb, "insert">;

let schemaReadyPromise: Promise<void> | undefined;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }

  if ("cause" in error) {
    return getErrorCode(error.cause);
  }

  return undefined;
}

function getErrorMessages(error: unknown): string[] {
  if (typeof error !== "object" || error === null) {
    return [];
  }

  const messages: string[] = [];

  if ("message" in error && typeof error.message === "string") {
    messages.push(error.message);
  }

  if ("cause" in error) {
    messages.push(...getErrorMessages(error.cause));
  }

  return messages;
}

function isAdminAlreadyCompleteError(error: unknown): boolean {
  if (getErrorCode(error) === "23505") {
    return true;
  }

  return getErrorMessages(error).some(
    (message) =>
      message.includes("admin_users_singleton_idx") ||
      message.includes("duplicate key value violates unique constraint"),
  );
}

async function ensureAuthSchema(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const sql = getSql();

      await sql`
        create table if not exists admin_users (
          id integer primary key generated always as identity,
          email text not null unique,
          password_hash text not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;

      await sql`
        create unique index if not exists admin_users_singleton_idx
        on admin_users ((true))
      `;

      await sql`
        create table if not exists admin_sessions (
          id integer primary key generated always as identity,
          user_id integer not null references admin_users(id) on delete cascade,
          token_hash text not null unique,
          expires_at timestamptz not null,
          created_at timestamptz not null default now(),
          last_seen_at timestamptz not null default now()
        )
      `;

      await sql`
        create index if not exists admin_sessions_user_id_idx
        on admin_sessions (user_id)
      `;

      await sql`
        create table if not exists admin_bootstrap_codes (
          id integer primary key generated always as identity,
          code_hash text not null unique,
          expires_at timestamptz not null,
          used_at timestamptz,
          created_at timestamptz not null default now()
        )
      `;

      await sql`
        create index if not exists admin_bootstrap_codes_lookup_idx
        on admin_bootstrap_codes (used_at, expires_at)
      `;
    })().catch((error) => {
      schemaReadyPromise = undefined;
      throw error;
    });
  }

  await schemaReadyPromise;
}

async function getAdminCount(): Promise<number> {
  await ensureAuthSchema();
  const db = getDb();
  const [row] = await db.select({ value: count() }).from(adminUsers);

  return row?.value ?? 0;
}

async function getAdminEmail(): Promise<string | null> {
  await ensureAuthSchema();
  const db = getDb();
  const [row] = await db
    .select({ email: adminUsers.email })
    .from(adminUsers)
    .orderBy(adminUsers.id)
    .limit(1);

  return row?.email ?? null;
}

async function hasPendingBootstrapCode(): Promise<boolean> {
  await ensureAuthSchema();
  const db = getDb();
  const [row] = await db
    .select({ id: adminBootstrapCodes.id })
    .from(adminBootstrapCodes)
    .where(
      and(
        isNull(adminBootstrapCodes.usedAt),
        gt(adminBootstrapCodes.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return Boolean(row);
}

async function createAdminSession(
  userId: number,
  email: string,
  db: AuthDbWriter = getDb(),
): Promise<AdminSession> {
  await ensureAuthSchema();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + ADMIN_SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000,
  );

  await db.insert(adminSessions).values({
    expiresAt,
    tokenHash: hashSessionToken(token),
    userId,
  });

  return {
    email,
    expiresAt,
    token,
    userId,
  };
}

export function setAdminSessionCookie(
  response: Response,
  session: AdminSession,
): void {
  appendSetCookie(
    response,
    serializeCookie({
      expires: session.expiresAt,
      httpOnly: true,
      name: ADMIN_SESSION_COOKIE,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      value: session.token,
    }),
  );
}

export function clearAdminSessionCookie(response: Response): void {
  appendSetCookie(
    response,
    serializeCookie({
      expires: new Date(0),
      httpOnly: true,
      name: ADMIN_SESSION_COOKIE,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      value: "",
    }),
  );
}

export function getAdminSessionToken(
  cookieHeader: string | null | undefined,
): string | undefined {
  return readCookie(cookieHeader, ADMIN_SESSION_COOKIE);
}

export async function revokeAdminSession(
  token: string | undefined,
): Promise<void> {
  if (!token || !serverEnv.DATABASE_URL) {
    return;
  }

  await ensureAuthSchema();
  const db = getDb();

  await db
    .delete(adminSessions)
    .where(eq(adminSessions.tokenHash, hashSessionToken(token)));
}

export async function getCurrentAdminSession(
  cookieHeader: string | null | undefined,
): Promise<CurrentAdminSession | null> {
  if (!serverEnv.DATABASE_URL) {
    return null;
  }

  await ensureAuthSchema();
  const token = getAdminSessionToken(cookieHeader);

  if (!token) {
    return null;
  }

  const db = getDb();

  await db
    .delete(adminSessions)
    .where(lte(adminSessions.expiresAt, new Date()));

  const [row] = await db
    .select({
      email: adminUsers.email,
      expiresAt: adminSessions.expiresAt,
      userId: adminSessions.userId,
    })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.userId))
    .where(
      and(
        eq(adminSessions.tokenHash, hashSessionToken(token)),
        gt(adminSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  await db
    .update(adminSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(adminSessions.tokenHash, hashSessionToken(token)));

  return {
    email: row.email,
    expiresAt: row.expiresAt,
    userId: row.userId,
  };
}

export async function getAdminAuthState(): Promise<AdminAuthState> {
  return getAdminAuthStateForCookieHeader(undefined);
}

export async function getAdminAuthStateForCookieHeader(
  cookieHeader: string | null | undefined,
): Promise<AdminAuthState> {
  const databaseConfigured = Boolean(serverEnv.DATABASE_URL);

  if (!databaseConfigured) {
    return {
      adminEmail: null,
      bootstrapCodeReady: false,
      databaseConfigured,
      initialized: false,
      session: null,
    };
  }

  const initialized = (await getAdminCount()) > 0;
  const session = initialized
    ? await getCurrentAdminSession(cookieHeader)
    : null;

  return {
    adminEmail: initialized ? await getAdminEmail() : null,
    bootstrapCodeReady: initialized ? false : await hasPendingBootstrapCode(),
    databaseConfigured,
    initialized,
    session,
  };
}

export async function bootstrapAdmin(input: {
  bootstrapCode: string;
  email: string;
  password: string;
}): Promise<AuthActionResult> {
  if (!serverEnv.DATABASE_URL) {
    return { error: "DATABASE_URL is not configured.", ok: false };
  }

  const parsed = setupInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      error:
        parsed.error.flatten().formErrors[0] ??
        parsed.error.flatten().fieldErrors.password?.[0] ??
        "Enter a valid admin email and a password of at least 10 characters.",
      ok: false,
    };
  }

  await ensureAuthSchema();
  const db = getDb();
  const email = normalizeEmail(parsed.data.email);
  const passwordHash = hashPassword(parsed.data.password);
  const codeHash = hashBootstrapCode(parsed.data.bootstrapCode);

  try {
    const setupResult = await db.transaction(async (transactionDb) => {
      const [consumedCode] = await transactionDb
        .update(adminBootstrapCodes)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(adminBootstrapCodes.codeHash, codeHash),
            isNull(adminBootstrapCodes.usedAt),
            gt(adminBootstrapCodes.expiresAt, new Date()),
          ),
        )
        .returning({ id: adminBootstrapCodes.id });

      if (!consumedCode) {
        throw new Error("Bootstrap code is invalid, expired, or already used.");
      }

      const [user] = await transactionDb
        .insert(adminUsers)
        .values({
          email,
          passwordHash,
        })
        .returning({ email: adminUsers.email, id: adminUsers.id });

      const session = await createAdminSession(
        user.id,
        user.email,
        transactionDb,
      );

      return { session };
    });

    return {
      ok: true,
      session: setupResult.session,
    };
  } catch (error) {
    if (isAdminAlreadyCompleteError(error)) {
      return { error: "Admin setup is already complete.", ok: false };
    }

    if (error instanceof Error) {
      return { error: error.message, ok: false };
    }

    return { error: "Admin setup failed.", ok: false };
  }
}

export async function loginAdmin(input: {
  adminSecurity: AdminSecurityConfig;
  challengeToken?: string;
  email: string;
  password: string;
  request?: Request;
}): Promise<AuthActionResult> {
  if (!serverEnv.DATABASE_URL) {
    return { error: "DATABASE_URL is not configured.", ok: false };
  }

  const parsed = loginInputSchema.safeParse(input);

  if (!parsed.success) {
    await recordAdminLoginFailure({
      email: input.email,
      reason: "invalid_input",
      request: input.request,
    });
    await delayAfterFailedAdminLogin(input.adminSecurity);
    return { error: "Enter a valid admin email and password.", ok: false };
  }

  await ensureAuthSchema();
  const db = getDb();
  const email = normalizeEmail(parsed.data.email);
  const protection = await checkAdminLoginProtection({
    adminSecurity: input.adminSecurity,
    challengeToken: input.challengeToken,
    email,
    request: input.request,
  });

  if (!protection.ok) {
    await recordAdminLoginFailure({
      email,
      keys: protection.keys,
      reason: protection.challengeRequired ? "challenge_failed" : "locked",
    });
    await delayAfterFailedAdminLogin(input.adminSecurity);
    return {
      challengeRequired: protection.challengeRequired,
      error: protection.error,
      ok: false,
    };
  }

  const [user] = await db
    .select({
      email: adminUsers.email,
      id: adminUsers.id,
      passwordHash: adminUsers.passwordHash,
    })
    .from(adminUsers)
    .where(eq(adminUsers.email, email))
    .limit(1);

  const passwordMatches = verifyPassword(
    parsed.data.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!user || !passwordMatches) {
    await recordAdminLoginFailure({
      email,
      keys: protection.keys,
      reason: "invalid_credentials",
    });
    await delayAfterFailedAdminLogin(input.adminSecurity);
    return {
      challengeRequired: protection.challengeRequired,
      error: "Email or password is incorrect.",
      ok: false,
    };
  }

  await clearAdminLoginFailures({
    email,
    keys: protection.keys,
  });

  return {
    ok: true,
    session: await createAdminSession(user.id, user.email),
  };
}

export async function createBootstrapCode(): Promise<{
  code: string;
  expiresAt: Date;
}> {
  if (!serverEnv.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  await ensureAuthSchema();

  if ((await getAdminCount()) > 0) {
    throw new Error("Admin setup is already complete.");
  }

  const db = getDb();
  const code = generateBootstrapCode();
  const expiresAt = getBootstrapCodeExpiry();

  await db.insert(adminBootstrapCodes).values({
    codeHash: hashBootstrapCode(code),
    expiresAt,
  });

  return {
    code,
    expiresAt,
  };
}

export async function bootstrapAdminForDevelopment(input: {
  email: string;
  password: string;
}): Promise<DirectBootstrapResult> {
  if (process.env.NODE_ENV === "production") {
    return {
      error: DEV_BOOTSTRAP_DISABLED_MESSAGE,
      ok: false,
    };
  }

  if (!serverEnv.DATABASE_URL) {
    return { error: "DATABASE_URL is not configured.", ok: false };
  }

  const parsed = directSetupInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      error:
        parsed.error.flatten().formErrors[0] ??
        parsed.error.flatten().fieldErrors.password?.[0] ??
        "Enter a valid admin email and a password of at least 10 characters.",
      ok: false,
    };
  }

  await ensureAuthSchema();
  const db = getDb();
  const email = normalizeEmail(parsed.data.email);
  const passwordHash = hashPassword(parsed.data.password);

  try {
    const [user] = await db
      .insert(adminUsers)
      .values({
        email,
        passwordHash,
      })
      .returning({ email: adminUsers.email });

    return {
      created: true,
      email: user.email,
      ok: true,
    };
  } catch (error) {
    if (isAdminAlreadyCompleteError(error)) {
      return {
        created: false,
        email: (await getAdminEmail()) ?? email,
        ok: true,
      };
    }

    if (error instanceof Error) {
      return { error: error.message, ok: false };
    }

    return { error: "Development admin bootstrap failed.", ok: false };
  }
}

export async function resetAdminPassword(input: {
  email: string;
  password: string;
}): Promise<AdminPasswordResetResult> {
  if (!serverEnv.DATABASE_URL) {
    return { error: "DATABASE_URL is not configured.", ok: false };
  }

  const parsed = directSetupInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      error:
        parsed.error.flatten().formErrors[0] ??
        parsed.error.flatten().fieldErrors.password?.[0] ??
        "Enter a valid admin email and a password of at least 10 characters.",
      ok: false,
    };
  }

  await ensureAuthSchema();
  const db = getDb();
  const email = normalizeEmail(parsed.data.email);
  const passwordHash = hashPassword(parsed.data.password);

  try {
    const resetResult = await db.transaction(async (transactionDb) => {
      const [user] = await transactionDb
        .select({
          email: adminUsers.email,
          id: adminUsers.id,
        })
        .from(adminUsers)
        .orderBy(adminUsers.id)
        .limit(1);

      if (!user) {
        throw new Error(
          "No admin user exists yet. Use the bootstrap flow first.",
        );
      }

      if (user.email !== email) {
        throw new Error(
          "Provided email does not match the existing admin user.",
        );
      }

      await transactionDb
        .update(adminUsers)
        .set({
          passwordHash,
          updatedAt: new Date(),
        })
        .where(eq(adminUsers.id, user.id));

      const revokedSessions = await transactionDb
        .delete(adminSessions)
        .where(eq(adminSessions.userId, user.id))
        .returning({ id: adminSessions.id });

      return {
        email: user.email,
        revokedSessionCount: revokedSessions.length,
      };
    });

    return {
      email: resetResult.email,
      ok: true,
      revokedSessionCount: resetResult.revokedSessionCount,
    };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message, ok: false };
    }

    return { error: "Admin password reset failed.", ok: false };
  }
}
