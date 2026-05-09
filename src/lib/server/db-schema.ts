import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const adminUsers = pgTable(
  "admin_users",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  () => [uniqueIndex("admin_users_singleton_idx").on(sql`(true)`)],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("admin_sessions_user_id_idx").on(table.userId)],
);

export const adminBootstrapCodes = pgTable(
  "admin_bootstrap_codes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    codeHash: text("code_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    usedAt: timestamp("used_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("admin_bootstrap_codes_lookup_idx").on(table.usedAt, table.expiresAt),
  ],
);

export const adminLoginAttempts = pgTable(
  "admin_login_attempts",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    clientIpHash: text("client_ip_hash"),
    emailHash: text("email_hash"),
    emailIpHash: text("email_ip_hash"),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    reason: text("reason").notNull(),
  },
  (table) => [
    index("admin_login_attempts_client_ip_idx").on(
      table.clientIpHash,
      table.occurredAt,
    ),
    index("admin_login_attempts_email_idx").on(
      table.emailHash,
      table.occurredAt,
    ),
    index("admin_login_attempts_email_ip_idx").on(
      table.emailIpHash,
      table.occurredAt,
    ),
    index("admin_login_attempts_occurred_at_idx").on(table.occurredAt),
  ],
);

export const schema = {
  adminBootstrapCodes,
  adminLoginAttempts,
  adminSessions,
  adminUsers,
};
