CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"run_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_version_id" text NOT NULL,
	"kind" text NOT NULL,
	"owner_scope" text NOT NULL,
	"owner_user_id" text,
	"item_ref" text NOT NULL,
	"thread_ref" text NOT NULL,
	"source_ref" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"ended_by_user_id" text,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_org_id_run_id_item_ref_unique" UNIQUE("org_id","run_id","item_ref"),
	CONSTRAINT "reviews_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_owner_fk" FOREIGN KEY ("org_id","owner_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_org_id_status_idx" ON "reviews" USING btree ("org_id","status");