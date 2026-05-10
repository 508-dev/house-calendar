import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AdminSecurityConfig } from "@/lib/config/config";
import { serverEnv } from "../env";
import {
  checkAdminLoginProtection,
  getLoginProtectionDecision,
  hasRecentThresholdCrossing,
  isAdminLoginProtectionFullyDisabled,
  shouldRecordTurnstileFailure,
} from "./login-protection";

const originalFetch = globalThis.fetch;
const originalDatabaseUrl = serverEnv.DATABASE_URL;
const originalIdentifierPepper = serverEnv.ADMIN_LOGIN_IDENTIFIER_PEPPER;
const originalIpHeader = serverEnv.ADMIN_LOGIN_IP_HEADER;
const originalTurnstileSecretKey = serverEnv.ADMIN_TURNSTILE_SECRET_KEY;
const originalTurnstileSiteKey = serverEnv.ADMIN_TURNSTILE_SITE_KEY;
const originalDb = globalThis.__houseCalendarDb;
const originalSql = globalThis.__houseCalendarSql;

function baseAdminSecurity(): AdminSecurityConfig {
  return {
    loginChallenge: {
      afterFailures: 3,
      mode: "off",
      provider: "turnstile",
    },
    loginThrottle: {
      enabled: true,
      failureDelayMs: 0,
      lockoutMinutes: 15,
      maxEmailFailures: 8,
      maxEmailIpFailures: 5,
      maxIpDailyFailures: 120,
      maxIpFailures: 30,
      windowMinutes: 15,
    },
  };
}

function baseFailures() {
  return {
    emailFailures: 0,
    emailIpFailures: 0,
    emailIpLockedOut: false,
    emailLockedOut: false,
    ipDailyFailures: 0,
    ipDailyLockedOut: false,
    ipFailures: 0,
    ipLockedOut: false,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.__houseCalendarDb = originalDb;
  globalThis.__houseCalendarSql = originalSql;
  serverEnv.ADMIN_LOGIN_IDENTIFIER_PEPPER = originalIdentifierPepper;
  serverEnv.ADMIN_LOGIN_IP_HEADER = originalIpHeader;
  serverEnv.ADMIN_TURNSTILE_SECRET_KEY = originalTurnstileSecretKey;
  serverEnv.ADMIN_TURNSTILE_SITE_KEY = originalTurnstileSiteKey;
  serverEnv.DATABASE_URL = originalDatabaseUrl;
});

describe("hasRecentThresholdCrossing", () => {
  test("honors lockout duration after a threshold is crossed", () => {
    const minute = 60 * 1000;
    const nowMs = 100 * minute;

    expect(
      hasRecentThresholdCrossing({
        limit: 3,
        lockoutMs: 60 * minute,
        nowMs,
        timestampsMs: [40, 41, 42].map((value) => value * minute),
        windowMs: 15 * minute,
      }),
    ).toBe(true);
  });

  test("does not lock out when the threshold crossing is older than lockout", () => {
    const minute = 60 * 1000;
    const nowMs = 100 * minute;

    expect(
      hasRecentThresholdCrossing({
        limit: 3,
        lockoutMs: 30 * minute,
        nowMs,
        timestampsMs: [40, 41, 42].map((value) => value * minute),
        windowMs: 15 * minute,
      }),
    ).toBe(false);
  });

  test("does not lock out when failures never cross the limit inside the window", () => {
    const minute = 60 * 1000;
    const nowMs = 100 * minute;

    expect(
      hasRecentThresholdCrossing({
        limit: 3,
        lockoutMs: 60 * minute,
        nowMs,
        timestampsMs: [40, 60, 80].map((value) => value * minute),
        windowMs: 15 * minute,
      }),
    ).toBe(false);
  });

  test("supports daily windows that cross before the current 24-hour range", () => {
    const minute = 60 * 1000;
    const nowMs = 48 * 60 * minute;
    const oldFailures = Array.from(
      { length: 119 },
      (_, index) => nowMs - (24 * 60 + 30 - index * 0.1) * minute,
    );

    expect(
      hasRecentThresholdCrossing({
        limit: 120,
        lockoutMs: 60 * minute,
        nowMs,
        timestampsMs: [...oldFailures, nowMs - 30 * minute],
        windowMs: 24 * 60 * minute,
      }),
    ).toBe(true);
  });
});

describe("getLoginProtectionDecision", () => {
  test("requires a challenge after the configured failure threshold", () => {
    expect(
      getLoginProtectionDecision({
        challengeAfterFailures: 3,
        challengeMode: "after_failures",
        failures: {
          ...baseFailures(),
          emailFailures: 3,
        },
        throttleEnabled: true,
      }),
    ).toEqual({
      challengeRequired: true,
      challengeRequiredAfterFailure: true,
      lockedOut: false,
    });
  });

  test("does not require challenges when challenge mode is off", () => {
    expect(
      getLoginProtectionDecision({
        challengeAfterFailures: 3,
        challengeMode: "off",
        failures: {
          ...baseFailures(),
          emailFailures: 99,
        },
        throttleEnabled: true,
      }).challengeRequired,
    ).toBe(false);
  });

  test("requires a challenge after a failure that reaches the threshold", () => {
    expect(
      getLoginProtectionDecision({
        challengeAfterFailures: 3,
        challengeMode: "after_failures",
        failures: {
          ...baseFailures(),
          emailFailures: 2,
        },
        throttleEnabled: true,
      }),
    ).toEqual({
      challengeRequired: false,
      challengeRequiredAfterFailure: true,
      lockedOut: false,
    });
  });

  test("locks out only when throttling is enabled", () => {
    expect(
      getLoginProtectionDecision({
        challengeAfterFailures: 3,
        challengeMode: "off",
        failures: {
          ...baseFailures(),
          emailLockedOut: true,
        },
        throttleEnabled: false,
      }).lockedOut,
    ).toBe(false);

    expect(
      getLoginProtectionDecision({
        challengeAfterFailures: 3,
        challengeMode: "off",
        failures: {
          ...baseFailures(),
          emailLockedOut: true,
        },
        throttleEnabled: true,
      }).lockedOut,
    ).toBe(true);
  });
});

describe("isAdminLoginProtectionFullyDisabled", () => {
  test("short-circuits only when throttle and challenge are both off", () => {
    expect(
      isAdminLoginProtectionFullyDisabled({
        loginChallenge: {
          afterFailures: 3,
          mode: "off",
          provider: "turnstile",
        },
        loginThrottle: {
          enabled: false,
          failureDelayMs: 0,
          lockoutMinutes: 15,
          maxEmailFailures: 8,
          maxEmailIpFailures: 5,
          maxIpDailyFailures: 120,
          maxIpFailures: 30,
          windowMinutes: 15,
        },
      }),
    ).toBe(true);

    expect(
      isAdminLoginProtectionFullyDisabled({
        loginChallenge: {
          afterFailures: 3,
          mode: "always",
          provider: "turnstile",
        },
        loginThrottle: {
          enabled: false,
          failureDelayMs: 0,
          lockoutMinutes: 15,
          maxEmailFailures: 8,
          maxEmailIpFailures: 5,
          maxIpDailyFailures: 120,
          maxIpFailures: 30,
          windowMinutes: 15,
        },
      }),
    ).toBe(false);
  });
});

describe("shouldRecordTurnstileFailure", () => {
  test("records user-caused challenge failures", () => {
    expect(shouldRecordTurnstileFailure(["invalid-input-response"])).toBe(true);
    expect(shouldRecordTurnstileFailure(["timeout-or-duplicate"])).toBe(true);
  });

  test("does not record system or config challenge failures", () => {
    expect(shouldRecordTurnstileFailure(["invalid-input-secret"])).toBe(false);
    expect(shouldRecordTurnstileFailure(["internal-error"])).toBe(false);
    expect(shouldRecordTurnstileFailure(undefined)).toBe(false);
  });
});

describe("checkAdminLoginProtection", () => {
  test("does not record another failure when a DB-backed check is already locked", async () => {
    serverEnv.ADMIN_LOGIN_IDENTIFIER_PEPPER = "test-login-identifier-pepper";
    serverEnv.DATABASE_URL = "postgres://test";

    const sqlCalls: string[] = [];
    const fakeSql = async <T = unknown>(
      strings: TemplateStringsArray,
      ..._values: unknown[]
    ): Promise<T> => {
      const query = strings.join("?");
      sqlCalls.push(query);

      if (
        query.includes("select exists") &&
        query.includes("candidate.email_hash")
      ) {
        return [{ value: true }] as T;
      }

      if (query.includes("select exists")) {
        return [{ value: false }] as T;
      }

      return [] as T;
    };

    globalThis.__houseCalendarSql =
      fakeSql as unknown as typeof globalThis.__houseCalendarSql;
    globalThis.__houseCalendarDb = {
      delete: () => ({
        where: async () => undefined,
      }),
      select: () => ({
        from: () => ({
          where: async () => [{ value: 2 }],
        }),
      }),
    } as unknown as typeof globalThis.__houseCalendarDb;

    const result = await checkAdminLoginProtection({
      adminSecurity: {
        ...baseAdminSecurity(),
        loginThrottle: {
          ...baseAdminSecurity().loginThrottle,
          maxEmailFailures: 2,
        },
      },
      email: "admin@example.com",
    });

    expect(sqlCalls.some((query) => query.includes("select exists"))).toBe(
      true,
    );
    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.recordFailure).toBe(false);
      expect(result.error).toBe(
        "Too many login attempts. Wait a while and try again.",
      );
    }
  });

  test("verifies Turnstile without DB work when throttling is disabled and challenge is always required", async () => {
    serverEnv.ADMIN_LOGIN_IP_HEADER = "cf-connecting-ip";
    serverEnv.ADMIN_TURNSTILE_SECRET_KEY = "turnstile-secret";
    serverEnv.ADMIN_TURNSTILE_SITE_KEY = "turnstile-site";

    const fetchMock = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body;

        expect(body).toBeInstanceOf(URLSearchParams);

        const params = body as URLSearchParams;
        expect(params.get("remoteip")).toBe("203.0.113.7");
        expect(params.get("response")).toBe("valid-token");
        expect(params.get("secret")).toBe("turnstile-secret");

        return new Response(JSON.stringify({ success: true }), { status: 200 });
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await checkAdminLoginProtection({
      adminSecurity: {
        ...baseAdminSecurity(),
        loginChallenge: {
          afterFailures: 3,
          mode: "always",
          provider: "turnstile",
        },
        loginThrottle: {
          ...baseAdminSecurity().loginThrottle,
          enabled: false,
        },
      },
      challengeToken: "valid-token",
      email: "admin@example.com",
      request: new Request("https://example.com/admin/login", {
        headers: {
          "cf-connecting-ip": "203.0.113.7",
        },
      }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      challengeRequired: true,
      challengeRequiredAfterFailure: true,
      keys: {},
      ok: true,
    });
  });
});
