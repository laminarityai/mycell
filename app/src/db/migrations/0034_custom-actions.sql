CREATE TABLE "custom_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"app" text NOT NULL,
	"description" jsonb NOT NULL,
	"risk" text NOT NULL,
	"accepted_by" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"proposal_id" text,
	CONSTRAINT "custom_actions_org_id_name_unique" UNIQUE("org_id","name")
);
--> statement-breakpoint
ALTER TABLE "builder_proposals" ADD COLUMN "custom_actions" jsonb DEFAULT '[]'::jsonb NOT NULL;