ALTER TABLE "events" ALTER COLUMN "direction" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "mime_type" text;