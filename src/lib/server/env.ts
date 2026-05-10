import { z } from "zod";

function optionalPositiveInt() {
  return z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().positive().optional(),
  );
}

const serverEnvSchema = z.object({
  ADMIN_LOGIN_IDENTIFIER_PEPPER: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(16).optional(),
  ),
  ADMIN_LOGIN_IP_HEADER: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  ADMIN_TURNSTILE_SECRET_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  ADMIN_TURNSTILE_SITE_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  DATABASE_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  ICS_SYNC_TTL_MINUTES: optionalPositiveInt(),
  PORT: optionalPositiveInt(),
  POSTGRES_PORT: optionalPositiveInt(),
  VIEWER_PASSWORD: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
});

export const serverEnv = serverEnvSchema.parse({
  ADMIN_LOGIN_IDENTIFIER_PEPPER: process.env.ADMIN_LOGIN_IDENTIFIER_PEPPER,
  ADMIN_LOGIN_IP_HEADER: process.env.ADMIN_LOGIN_IP_HEADER,
  ADMIN_TURNSTILE_SECRET_KEY: process.env.ADMIN_TURNSTILE_SECRET_KEY,
  ADMIN_TURNSTILE_SITE_KEY: process.env.ADMIN_TURNSTILE_SITE_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
  ICS_SYNC_TTL_MINUTES: process.env.ICS_SYNC_TTL_MINUTES,
  PORT: process.env.PORT,
  POSTGRES_PORT: process.env.POSTGRES_PORT,
  VIEWER_PASSWORD: process.env.VIEWER_PASSWORD,
});
