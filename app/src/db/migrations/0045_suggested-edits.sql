CREATE TABLE "suggested_edit_writes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"source_ref" text NOT NULL,
	"owner_scope" text NOT NULL,
	"document_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"suggestion_ids_before" text[] NOT NULL,
	"created_suggestion_ids" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggested_edit_writes_org_id_run_id_step_id_unique" UNIQUE("org_id","run_id","step_id")
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "suggested_edit_writes" ADD CONSTRAINT "suggested_edit_writes_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggested_edit_writes" ADD CONSTRAINT "suggested_edit_writes_run_fk" FOREIGN KEY ("org_id","run_id") REFERENCES "public"."runs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggested_edit_writes_org_id_connection_id_idx" ON "suggested_edit_writes" USING btree ("org_id","connection_id");