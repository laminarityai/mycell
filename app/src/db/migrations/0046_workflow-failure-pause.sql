ALTER TABLE "workflows" ADD COLUMN "paused_reason" text;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "paused_by_run_ids" jsonb;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "resumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_paused_with_runs" CHECK (("workflows"."paused_reason" is null) = ("workflows"."paused_at" is null) and ("workflows"."paused_reason" is null) = ("workflows"."paused_by_run_ids" is null));