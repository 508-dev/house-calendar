import { afterEach, describe, expect, test } from "bun:test";
import { serverEnv } from "../env";
import { changeAdminPassword } from "./index";
import { hashPassword, verifyPassword } from "./password";

const originalDatabaseUrl = serverEnv.DATABASE_URL;
const originalDb = globalThis.__houseCalendarDb;
const originalSql = globalThis.__houseCalendarSql;

function installFakeSql() {
  globalThis.__houseCalendarSql =
    (async () => []) as unknown as typeof globalThis.__houseCalendarSql;
}

function baseAdminSecurity() {
  return {
    loginChallenge: {
      afterFailures: 3,
      mode: "off" as const,
      provider: "turnstile" as const,
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
  };
}

function createPasswordChangeDb(options: {
  activeSession?: boolean;
  currentPasswordHash: string;
  email?: string;
  failOnUpdate?: boolean;
  userId?: number;
}) {
  const operations = {
    deletedSessions: false,
    events: [] as string[],
    insertedSession: null as Record<string, unknown> | null,
    updatedPasswordHash: null as string | null,
  };
  const user = {
    email: options.email ?? "owner@example.com",
    id: options.userId ?? 1,
    passwordHash: options.currentPasswordHash,
  };
  const transactionDb = {
    delete: () => ({
      where: async () => {
        operations.deletedSessions = true;
        operations.events.push("deleteSessions");
      },
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        operations.insertedSession = values;
        operations.events.push("insertSession");
      },
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => (options.activeSession === false ? [] : [user]),
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: { passwordHash?: string }) => ({
        where: async () => {
          operations.events.push("updatePassword");
          if (options.failOnUpdate) {
            throw new Error("database constraint detail");
          }
          operations.updatedPasswordHash = values.passwordHash ?? null;
        },
      }),
    }),
  };

  globalThis.__houseCalendarDb = {
    select: transactionDb.select,
    transaction: async <T>(
      callback: (db: typeof transactionDb) => Promise<T>,
    ) => callback(transactionDb),
  } as unknown as typeof globalThis.__houseCalendarDb;

  return operations;
}

afterEach(() => {
  globalThis.__houseCalendarDb = originalDb;
  globalThis.__houseCalendarSql = originalSql;
  serverEnv.DATABASE_URL = originalDatabaseUrl;
});

describe("changeAdminPassword", () => {
  test("verifies the current password and replaces the active session", async () => {
    serverEnv.DATABASE_URL = "postgres://test";
    installFakeSql();
    const operations = createPasswordChangeDb({
      currentPasswordHash: hashPassword("current password"),
    });

    const result = await changeAdminPassword({
      adminSecurity: baseAdminSecurity(),
      currentPassword: "current password",
      currentSessionToken: "current-session-token",
      newPassword: "new strong password",
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.session.email).toBe("owner@example.com");
      expect(result.session.userId).toBe(1);
    }

    expect(typeof operations.updatedPasswordHash).toBe("string");
    expect(
      verifyPassword(
        "new strong password",
        operations.updatedPasswordHash ?? "",
      ),
    ).toBe(true);
    expect(operations.deletedSessions).toBe(true);
    expect(operations.insertedSession?.expiresAt).toBeInstanceOf(Date);
    expect(typeof operations.insertedSession?.tokenHash).toBe("string");
    expect(operations.insertedSession?.userId).toBe(1);
    expect(operations.events.indexOf("deleteSessions")).toBeLessThan(
      operations.events.indexOf("insertSession"),
    );
  });

  test("rejects an incorrect current password without mutating sessions", async () => {
    serverEnv.DATABASE_URL = "postgres://test";
    installFakeSql();
    const operations = createPasswordChangeDb({
      currentPasswordHash: hashPassword("current password"),
    });

    const result = await changeAdminPassword({
      adminSecurity: baseAdminSecurity(),
      currentPassword: "wrong password",
      currentSessionToken: "current-session-token",
      newPassword: "new strong password",
    });

    expect(result).toEqual({
      error: "Current password is incorrect.",
      ok: false,
      passwordErrorField: "currentPassword",
      requiresLogin: false,
    });
    expect(operations.updatedPasswordHash).toBeNull();
    expect(operations.deletedSessions).toBe(false);
    expect(operations.insertedSession).toBeNull();
  });

  test("does not record password-change attempts when only login challenges are enabled", async () => {
    serverEnv.DATABASE_URL = "postgres://test";
    installFakeSql();
    const operations = createPasswordChangeDb({
      currentPasswordHash: hashPassword("current password"),
    });

    const result = await changeAdminPassword({
      adminSecurity: {
        ...baseAdminSecurity(),
        loginChallenge: {
          afterFailures: 1,
          mode: "always",
          provider: "turnstile",
        },
      },
      currentPassword: "wrong password",
      currentSessionToken: "current-session-token",
      newPassword: "new strong password",
    });

    expect(result).toEqual({
      error: "Current password is incorrect.",
      ok: false,
      passwordErrorField: "currentPassword",
      requiresLogin: false,
    });
    expect(operations.updatedPasswordHash).toBeNull();
    expect(operations.deletedSessions).toBe(false);
    expect(operations.insertedSession).toBeNull();
  });

  test("requires an active session before changing the password", async () => {
    serverEnv.DATABASE_URL = "postgres://test";
    installFakeSql();
    const operations = createPasswordChangeDb({
      activeSession: false,
      currentPasswordHash: hashPassword("current password"),
    });

    const result = await changeAdminPassword({
      adminSecurity: baseAdminSecurity(),
      currentPassword: "current password",
      currentSessionToken: "expired-session-token",
      newPassword: "new strong password",
    });

    expect(result).toEqual({
      error: "Admin session has expired. Sign in again.",
      ok: false,
      requiresLogin: true,
    });
    expect(operations.updatedPasswordHash).toBeNull();
    expect(operations.deletedSessions).toBe(false);
    expect(operations.insertedSession).toBeNull();
  });

  test("does not expose unexpected database errors to the user", async () => {
    serverEnv.DATABASE_URL = "postgres://test";
    installFakeSql();
    const operations = createPasswordChangeDb({
      currentPasswordHash: hashPassword("current password"),
      failOnUpdate: true,
    });

    const result = await changeAdminPassword({
      adminSecurity: baseAdminSecurity(),
      currentPassword: "current password",
      currentSessionToken: "current-session-token",
      newPassword: "new strong password",
    });

    expect(result).toEqual({
      error: "Admin password change failed.",
      ok: false,
    });
    expect(operations.updatedPasswordHash).toBeNull();
    expect(operations.deletedSessions).toBe(false);
    expect(operations.insertedSession).toBeNull();
  });
});
