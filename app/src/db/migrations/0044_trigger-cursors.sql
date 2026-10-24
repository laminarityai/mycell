CREATE TABLE "trigger_cursors" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"trigger" text NOT NULL,
	"cursor" text NOT NULL,
	"polled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trigger_cursors_connection_id_trigger_unique" UNIQUE("connection_id","trigger")
);
--> statement-breakpoint
ALTER TABLE "trigger_cursors" ADD CONSTRAINT "trigger_cursors_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;