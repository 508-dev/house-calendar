import { createHmac } from "node:crypto";
import { and, count, eq, gt, lte, ne, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AdminSecurityConfig } from "@/lib/config/config";
import { getDb, getSql } from "../db";
import { adminLoginAttempts } from "../db-schema";
import { serverEnv } from "../env";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const TURNSTILE_VERIFY_TIMEOUT_MS = 5_000;
const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const turnstileVerifyResponseSchema = z.object({
  "error-codes": z.array(z.string()).optional(),
  success: z.boolean(),
});

let schemaReadyPromise: Promise<void> | undefined;
let lastCleanupStartedAtMs = 0;
let cleanupPromise: Promise<void> | undefined;

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

type LoginFailureCounts = {
  emailFailures: number;
  emailIpFailures: number;
  emailIpLockedOut: boolean;
  emailLockedOut: boolean;
  ipDailyFailures: number;
  ipDailyLockedOut: boolean;
  ipFailures: number;
  ipLockedOut: boolean;
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
      challengeRequired: boolean;
      challengeRequiredAfterFailure: boolean;
      keys: LoginAttemptKeys;
      ok: true;
    }
  | {
      challengeRequired?: boolean;
      error: string;
      keys: LoginAttemptKeys;
      ok: false;
      recordFailure: boolean;
    };

export type AdminPasswordChangeProtectionCheck =
  | {
      keys: LoginAttemptKeys;
      ok: true;
    }
  | {
      error: string;
      keys: LoginAttemptKeys;
      ok: false;
    };

export function hasRecentThresholdCrossing({
  limit,
  lockoutMs,
  nowMs,
  timestampsMs,
  windowMs,
}: {
  limit: number;
  lockoutMs: number;
  nowMs: number;
  timestampsMs: number[];
  windowMs: number;
}): boolean {
  if (limit <= 0) {
    return false;
  }

  const sorted = [...timestampsMs].sort((left, right) => left - right);
  const lockoutStartMs = nowMs - lockoutMs;

  for (let index = limit - 1; index < sorted.length; index += 1) {
    const thresholdCrossedAtMs = sorted[index];

    if (thresholdCrossedAtMs <= lockoutStartMs) {
      continue;
    }

    const windowStartedAtMs = sorted[index - limit + 1];

    if (thresholdCrossedAtMs - windowStartedAtMs <= windowMs) {
      return true;
    }
  }

  return false;
}

export function getLoginProtectionDecision({
  challengeAfterFailures,
  challengeMode,
  failures,
  throttleEnabled,
}: {
  challengeAfterFailures: number;
  challengeMode: "off" | "always" | "after_failures";
  failures: LoginFailureCounts;
  throttleEnabled: boolean;
}): {
  challengeRequired: boolean;
  challengeRequiredAfterFailure: boolean;
  lockedOut: boolean;
} {
  const maxCurrentFailures = Math.max(
    failures.emailFailures,
    failures.emailIpFailures,
    failures.ipFailures,
  );
  const challengeRequired =
    challengeMode === "always" ||
    (challengeMode === "after_failures" &&
      maxCurrentFailures >= challengeAfterFailures);
  const challengeRequiredAfterFailure =
    challengeMode === "always" ||
    (challengeMode === "after_failures" &&
      maxCurrentFailures + 1 >= challengeAfterFailures);

  const lockedOut =
    throttleEnabled &&
    (failures.emailLockedOut ||
      failures.emailIpLockedOut ||
      failures.ipLockedOut ||
      failures.ipDailyLockedOut);

  return {
    challengeRequired,
    challengeRequiredAfterFailure,
    lockedOut,
  };
}

export function isAdminLoginProtectionFullyDisabled(
  adminSecurity: AdminSecurityConfig,
): boolean {
  return (
    !adminSecurity.loginThrottle.enabled &&
    adminSecurity.loginChallenge.mode === "off"
  );
}

export function shouldRecordTurnstileFailure(
  errorCodes: string[] | undefined,
): boolean {
  return (errorCodes ?? []).some((code) =>
    new Set([
      "invalid-input-response",
      "missing-input-response",
      "timeout-or-duplicate",
    ]).has(code),
  );
}

function getLoginProtectionConfig(
  adminSecurity: AdminSecurityConfig,
): LoginProtectionConfig {
  return {
    challengeAfterFailures: adminSecurity.loginChallenge.afterFailures,
    challengeMode: adminSecurity.loginChallenge.mode,
    emailFailureLimit: adminSecurity.loginThrottle.maxEmailFailures,
    emailIpFailureLimit: adminSecurity.loginThrottle.maxEmailIpFailures,
    failureDelayMs:
      process.env.NODE_ENV === "test" || !adminSecurity.loginThrottle.enabled
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
          reason text not null,
          constraint admin_login_attempts_scope_chk
            check (
              client_ip_hash is not null
              or email_hash is not null
              or email_ip_hash is not null
            )
        )
      `;

      await sql`
        do $$
        begin
          if not exists (
            select 1
            from pg_constraint
            where conname = 'admin_login_attempts_scope_chk'
          ) then
            alter table admin_login_attempts
              add constraint admin_login_attempts_scope_chk
              check (
                client_ip_hash is not null
                or email_hash is not null
                or email_ip_hash is not null
              );
          end if;
        end $$;
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

function getLoginIdentifierPepper(): string {
  const pepper =
    serverEnv.ADMIN_LOGIN_IDENTIFIER_PEPPER ?? serverEnv.DATABASE_URL;

  if (!pepper) {
    throw new Error(
      "ADMIN_LOGIN_IDENTIFIER_PEPPER or DATABASE_URL is required for login attempt hashing.",
    );
  }

  return pepper;
}

function hashIdentifier(value: string): string {
  return createHmac("sha256", getLoginIdentifierPepper())
    .update(value)
    .digest("base64url");
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
  const retentionMs = Math.max(
    ONE_DAY_MS + config.lockoutMs,
    config.windowMs + config.lockoutMs,
  );
  await getDb()
    .delete(adminLoginAttempts)
    .where(
      lte(adminLoginAttempts.occurredAt, new Date(Date.now() - retentionMs)),
    );
}

async function maybeCleanupOldAttempts(
  config: LoginProtectionConfig,
): Promise<void> {
  const nowMs = Date.now();

  if (cleanupPromise) {
    return cleanupPromise;
  }

  if (nowMs - lastCleanupStartedAtMs < CLEANUP_INTERVAL_MS) {
    return;
  }

  lastCleanupStartedAtMs = nowMs;
  cleanupPromise = cleanupOldAttempts(config).finally(() => {
    cleanupPromise = undefined;
  });

  return cleanupPromise;
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

type LoginAttemptKeyColumn = "clientIpHash" | "emailHash" | "emailIpHash";

async function hasRecentThresholdCrossingInDb({
  keyColumn,
  keyHash,
  limit,
  lockoutMs,
  nowMs,
  windowMs,
}: {
  keyColumn: LoginAttemptKeyColumn;
  keyHash: string | undefined;
  limit: number;
  lockoutMs: number;
  nowMs: number;
  windowMs: number;
}): Promise<boolean> {
  if (!keyHash || limit <= 0) {
    return false;
  }

  const sql = getSql();
  const lockoutStart = new Date(nowMs - lockoutMs);

  if (keyColumn === "emailHash") {
    const [row] = await sql<{ value: boolean }[]>`
      select exists (
        select 1
        from admin_login_attempts candidate
        where candidate.email_hash = ${keyHash}
          and candidate.reason <> 'locked'
          and candidate.occurred_at > ${lockoutStart}
          and (
            select count(*)
            from admin_login_attempts attempt
            where attempt.email_hash = ${keyHash}
              and attempt.reason <> 'locked'
              and attempt.occurred_at > candidate.occurred_at - (${windowMs} * interval '1 millisecond')
              and attempt.occurred_at <= candidate.occurred_at
          ) >= ${limit}
      ) as value
    `;

    return row?.value ?? false;
  }

  if (keyColumn === "emailIpHash") {
    const [row] = await sql<{ value: boolean }[]>`
      select exists (
        select 1
        from admin_login_attempts candidate
        where candidate.email_ip_hash = ${keyHash}
          and candidate.reason <> 'locked'
          and candidate.occurred_at > ${lockoutStart}
          and (
            select count(*)
            from admin_login_attempts attempt
            where attempt.email_ip_hash = ${keyHash}
              and attempt.reason <> 'locked'
              and attempt.occurred_at > candidate.occurred_at - (${windowMs} * interval '1 millisecond')
              and attempt.occurred_at <= candidate.occurred_at
          ) >= ${limit}
      ) as value
    `;

    return row?.value ?? false;
  }

  const [row] = await sql<{ value: boolean }[]>`
    select exists (
      select 1
      from admin_login_attempts candidate
      where candidate.client_ip_hash = ${keyHash}
        and candidate.reason <> 'locked'
        and candidate.occurred_at > ${lockoutStart}
        and (
          select count(*)
          from admin_login_attempts attempt
          where attempt.client_ip_hash = ${keyHash}
            and attempt.reason <> 'locked'
            and attempt.occurred_at > candidate.occurred_at - (${windowMs} * interval '1 millisecond')
            and attempt.occurred_at <= candidate.occurred_at
        ) >= ${limit}
    ) as value
  `;

  return row?.value ?? false;
}

async function getFailureCounts(
  keys: LoginAttemptKeys,
  config: LoginProtectionConfig,
) {
  const nowMs = Date.now();
  const windowStartMs = nowMs - config.windowMs;
  const dailyStartMs = nowMs - ONE_DAY_MS;
  const scanStart = new Date(
    nowMs -
      Math.max(
        ONE_DAY_MS + config.lockoutMs,
        config.windowMs + config.lockoutMs,
      ),
  );
  const recentUnlockedAttempt = and(
    gt(adminLoginAttempts.occurredAt, scanStart),
    ne(adminLoginAttempts.reason, "locked"),
  );

  const [
    emailFailures,
    emailIpFailures,
    ipFailures,
    ipDailyFailures,
    emailLockedOut,
    emailIpLockedOut,
    ipLockedOut,
    ipDailyLockedOut,
  ] = await Promise.all([
    countFailures(
      keys.emailHash
        ? and(
            eq(adminLoginAttempts.emailHash, keys.emailHash),
            gt(adminLoginAttempts.occurredAt, new Date(windowStartMs)),
            recentUnlockedAttempt,
          )
        : undefined,
    ),
    countFailures(
      keys.emailIpHash
        ? and(
            eq(adminLoginAttempts.emailIpHash, keys.emailIpHash),
            gt(adminLoginAttempts.occurredAt, new Date(windowStartMs)),
            recentUnlockedAttempt,
          )
        : undefined,
    ),
    countFailures(
      keys.clientIpHash
        ? and(
            eq(adminLoginAttempts.clientIpHash, keys.clientIpHash),
            gt(adminLoginAttempts.occurredAt, new Date(windowStartMs)),
            recentUnlockedAttempt,
          )
        : undefined,
    ),
    countFailures(
      keys.clientIpHash
        ? and(
            eq(adminLoginAttempts.clientIpHash, keys.clientIpHash),
            gt(adminLoginAttempts.occurredAt, new Date(dailyStartMs)),
            recentUnlockedAttempt,
          )
        : undefined,
    ),
    hasRecentThresholdCrossingInDb({
      keyColumn: "emailHash",
      keyHash: keys.emailHash,
      limit: config.emailFailureLimit,
      lockoutMs: config.lockoutMs,
      nowMs,
      windowMs: config.windowMs,
    }),
    hasRecentThresholdCrossingInDb({
      keyColumn: "emailIpHash",
      keyHash: keys.emailIpHash,
      limit: config.emailIpFailureLimit,
      lockoutMs: config.lockoutMs,
      nowMs,
      windowMs: config.windowMs,
    }),
    hasRecentThresholdCrossingInDb({
      keyColumn: "clientIpHash",
      keyHash: keys.clientIpHash,
      limit: config.ipFailureLimit,
      lockoutMs: config.lockoutMs,
      nowMs,
      windowMs: config.windowMs,
    }),
    hasRecentThresholdCrossingInDb({
      keyColumn: "clientIpHash",
      keyHash: keys.clientIpHash,
      limit: config.ipDailyFailureLimit,
      lockoutMs: config.lockoutMs,
      nowMs,
      windowMs: ONE_DAY_MS,
    }),
  ]);

  return {
    emailFailures,
    emailIpFailures,
    emailIpLockedOut,
    emailLockedOut,
    ipDailyFailures,
    ipDailyLockedOut,
    ipFailures,
    ipLockedOut,
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
}): Promise<{ error?: string; ok: boolean; recordFailure: boolean }> {
  if (!config.turnstileSiteKey) {
    return {
      error:
        "Admin login challenge is enabled, but ADMIN_TURNSTILE_SITE_KEY is not configured.",
      ok: false,
      recordFailure: false,
    };
  }

  if (!config.turnstileSecretKey) {
    return {
      error:
        "Admin login challenge is enabled, but ADMIN_TURNSTILE_SECRET_KEY is not configured.",
      ok: false,
      recordFailure: false,
    };
  }

  if (!token) {
    return {
      error: "Complete the login challenge and try again.",
      ok: false,
      recordFailure: true,
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
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      TURNSTILE_VERIFY_TIMEOUT_MS,
    );
    let response: Response;

    try {
      response = await fetch(TURNSTILE_SITEVERIFY_URL, {
        body,
        method: "POST",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const parsed = turnstileVerifyResponseSchema.safeParse(
      await response.json(),
    );

    if (!response.ok || !parsed.success) {
      return {
        error: "The login challenge could not be verified.",
        ok: false,
        recordFailure: false,
      };
    }

    if (!parsed.data.success) {
      return {
        error: "The login challenge could not be verified.",
        ok: false,
        recordFailure: shouldRecordTurnstileFailure(parsed.data["error-codes"]),
      };
    }

    return { ok: true, recordFailure: false };
  } catch {
    return {
      error: "The login challenge could not be verified.",
      ok: false,
      recordFailure: false,
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
  const config = getLoginProtectionConfig(adminSecurity);

  if (isAdminLoginProtectionFullyDisabled(adminSecurity)) {
    return {
      challengeRequired: false,
      challengeRequiredAfterFailure: false,
      keys: {},
      ok: true,
    };
  }

  if (!config.throttleEnabled && config.challengeMode === "always") {
    const challenge = await verifyTurnstileChallenge({
      clientIp: getTrustedClientIp(request),
      config,
      token: challengeToken,
    });

    if (!challenge.ok) {
      return {
        challengeRequired: true,
        error: challenge.error ?? "Complete the login challenge and try again.",
        keys: {},
        ok: false,
        recordFailure: challenge.recordFailure,
      };
    }

    return {
      challengeRequired: true,
      challengeRequiredAfterFailure: true,
      keys: {},
      ok: true,
    };
  }

  if (!serverEnv.DATABASE_URL) {
    return {
      challengeRequired: false,
      challengeRequiredAfterFailure: false,
      keys: {},
      ok: true,
    };
  }

  const keys = buildAttemptKeys(email, request);
  await ensureLoginProtectionSchema();
  await maybeCleanupOldAttempts(config);

  const failures = await getFailureCounts(keys, config);
  const { challengeRequired, challengeRequiredAfterFailure, lockedOut } =
    getLoginProtectionDecision({
      challengeAfterFailures: config.challengeAfterFailures,
      challengeMode: config.challengeMode,
      failures,
      throttleEnabled: config.throttleEnabled,
    });

  if (lockedOut) {
    return {
      error: "Too many login attempts. Wait a while and try again.",
      keys,
      ok: false,
      recordFailure: false,
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
        recordFailure: challenge.recordFailure,
      };
    }
  }

  return { challengeRequired, challengeRequiredAfterFailure, keys, ok: true };
}

export async function checkAdminPasswordChangeProtection({
  adminSecurity,
  email,
  request,
}: {
  adminSecurity: AdminSecurityConfig;
  email: string;
  request?: Request;
}): Promise<AdminPasswordChangeProtectionCheck> {
  const config = getLoginProtectionConfig(adminSecurity);

  if (
    isAdminLoginProtectionFullyDisabled(adminSecurity) ||
    !config.throttleEnabled ||
    !serverEnv.DATABASE_URL
  ) {
    return {
      keys: {},
      ok: true,
    };
  }

  const keys = buildAttemptKeys(email, request);
  await ensureLoginProtectionSchema();
  await maybeCleanupOldAttempts(config);

  const failures = await getFailureCounts(keys, config);
  const { lockedOut } = getLoginProtectionDecision({
    challengeAfterFailures: config.challengeAfterFailures,
    challengeMode: "off",
    failures,
    throttleEnabled: config.throttleEnabled,
  });

  if (lockedOut) {
    return {
      error: "Too many login attempts. Wait a while and try again.",
      keys,
      ok: false,
    };
  }

  return {
    keys,
    ok: true,
  };
}

export async function recordAdminLoginFailure({
  adminSecurity,
  email,
  keys,
  reason,
  request,
}: {
  adminSecurity?: AdminSecurityConfig;
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

  if (adminSecurity && !isAdminLoginProtectionFullyDisabled(adminSecurity)) {
    await maybeCleanupOldAttempts(getLoginProtectionConfig(adminSecurity));
  }

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
