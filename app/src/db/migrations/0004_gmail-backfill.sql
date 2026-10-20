CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"owner_scope" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"actor" text,
	"counterparties" text[] NOT NULL,
	"direction" text NOT NULL,
	"thread_id" text,
	"attachments" jsonb NOT NULL,
	"label_ids" text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "events_connection_id_source_ref_unique" UNIQUE("connection_id","source_ref"),
	CONSTRAINT "events_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "object_refs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"event_id" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "object_refs_event_id_kind_key_unique" UNIQUE("event_id","kind","key")
);
--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "backfilled_items" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "cursor" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_refs" ADD CONSTRAINT "object_refs_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_refs" ADD CONSTRAINT "object_refs_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "public"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "object_refs_org_id_kind_key_idx" ON "object_refs" USING btree ("org_id","kind","key");--> statement-breakpoint
CREATE INDEX "object_refs_connection_id_idx" ON "object_refs" USING btree ("connection_id");