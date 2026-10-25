CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"event_id" text NOT NULL,
	"written_at" timestamp with time zone NOT NULL,
	CONSTRAINT "outbox_org_id_event_id_unique" UNIQUE("org_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_org_id_written_at_idx" ON "outbox" USING btree ("org_id","written_at");