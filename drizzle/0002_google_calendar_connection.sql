CREATE TABLE "google_calendar_connection" (
	"id" integer PRIMARY KEY NOT NULL,
	"client_id" text,
	"encrypted_refresh_token" text,
	"revision" text NOT NULL,
	"state_hash" text,
	"session_hash" text,
	"pkce_verifier" text,
	"site_id" text,
	"state_expires_at" timestamp with time zone,
	CONSTRAINT "google_calendar_connection_singleton" CHECK ("google_calendar_connection"."id" = 1)
);
