CREATE TABLE "ingest_states" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"app" text NOT NULL,
	"status" text NOT NULL,
	"backfilled_items" integer DEFAULT 0 NOT NULL,
	"cursor" text,
	"last_polled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_states_connection_id_app_unique" UNIQUE("connection_id","app")
);
--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "granted_scopes" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "needs_reauth" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest_states" ADD CONSTRAINT "ingest_states_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;