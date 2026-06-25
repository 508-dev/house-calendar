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

function createPasswordChangeDb(options: {
  currentPasswordHash: string;
  email?: string;
  userId?: number;
}) {
  const operations = {
    deletedSessions: false,
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
      },
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        operations.insertedSession = values;
      },
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => [user],
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: { passwordHash?: string }) => ({
        where: async () => {
          operations.updatedPasswordHash = values.passwordHash ?? null;
        },
      }),
    }),
  };

  globalThis.__houseCalendarDb = {
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
  });

  test("rejects an incorrect current password without mutating sessions", async () => {
    serverEnv.DATABASE_URL = "postgres://test";
    installFakeSql();
    const operations = createPasswordChangeDb({
      currentPasswordHash: hashPassword("current password"),
    });

    const result = await changeAdminPassword({
      currentPassword: "wrong password",
      currentSessionToken: "current-session-token",
      newPassword: "new strong password",
    });

    expect(result).toEqual({
      error: "Current password is incorrect.",
      ok: false,
      requiresLogin: false,
    });
    expect(operations.updatedPasswordHash).toBeNull();
    expect(operations.deletedSessions).toBe(false);
    expect(operations.insertedSession).toBeNull();
  });
});
