ALTER TABLE "enablements" ADD COLUMN "paused_reason" text;--> statement-breakpoint
ALTER TABLE "enablements" ADD COLUMN "paused_change" jsonb;--> statement-breakpoint
ALTER TABLE "enablements" ADD CONSTRAINT "enablements_paused_with_reason" CHECK (("enablements"."status" = 'paused') = ("enablements"."paused_reason" is not null));