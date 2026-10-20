-- Gives M3's times a time zone, so they read back as the moment they were recorded whatever the
-- database's time zone is. Stored times are read as UTC: the app writes UTC, and the now()
-- defaults wrote UTC on a UTC database. Defaults written on a non-UTC database stay shifted.
ALTER TABLE "ingest_states" ALTER COLUMN "last_polled_at" SET DATA TYPE timestamp with time zone USING "last_polled_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "ingest_states" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "ingest_states" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "credit_ledger" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "credit_ledger" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "model_roles" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "model_roles" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "run_steps" ALTER COLUMN "last_attempt_at" SET DATA TYPE timestamp with time zone USING "last_attempt_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "run_steps" ALTER COLUMN "last_attempt_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "run_steps" ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone USING "started_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "run_steps" ALTER COLUMN "finished_at" SET DATA TYPE timestamp with time zone USING "finished_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone USING "started_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "started_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "finished_at" SET DATA TYPE timestamp with time zone USING "finished_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "enablements" ALTER COLUMN "enabled_at" SET DATA TYPE timestamp with time zone USING "enabled_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "workflow_versions" ALTER COLUMN "published_at" SET DATA TYPE timestamp with time zone USING "published_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "workflow_versions" ALTER COLUMN "published_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "workflows" ALTER COLUMN "org_switched_on_at" SET DATA TYPE timestamp with time zone USING "org_switched_on_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "workflows" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "workflows" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "workflows" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "workflows" ALTER COLUMN "updated_at" SET DEFAULT now();