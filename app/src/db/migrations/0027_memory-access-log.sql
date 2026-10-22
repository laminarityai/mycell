CREATE TABLE "access_log_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" text NOT NULL,
	"reader_kind" text NOT NULL,
	"user_id" text,
	"run_id" text,
	"workflow_id" text,
	"staff_consent_id" text,
	"object_ids" text[] NOT NULL,
	"fact_ids" text[] NOT NULL,
	"source_owner_ids" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"granted_by_user_id" text NOT NULL,
	"staff_email" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "access_log_entries_org_id_read_at_idx" ON "access_log_entries" USING btree ("org_id","read_at");--> statement-breakpoint
CREATE INDEX "access_log_entries_source_owner_ids_idx" ON "access_log_entries" USING gin ("source_owner_ids");--> statement-breakpoint
CREATE INDEX "staff_consents_org_id_idx" ON "staff_consents" USING btree ("org_id");