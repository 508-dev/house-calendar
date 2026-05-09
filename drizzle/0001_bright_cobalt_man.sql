CREATE TABLE "admin_login_attempts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_login_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"client_ip_hash" text,
	"email_hash" text,
	"email_ip_hash" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_login_attempts_client_ip_idx" ON "admin_login_attempts" USING btree ("client_ip_hash","occurred_at");--> statement-breakpoint
CREATE INDEX "admin_login_attempts_email_idx" ON "admin_login_attempts" USING btree ("email_hash","occurred_at");--> statement-breakpoint
CREATE INDEX "admin_login_attempts_email_ip_idx" ON "admin_login_attempts" USING btree ("email_ip_hash","occurred_at");--> statement-breakpoint
CREATE INDEX "admin_login_attempts_occurred_at_idx" ON "admin_login_attempts" USING btree ("occurred_at");