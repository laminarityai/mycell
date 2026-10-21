CREATE TABLE "builder_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"workflow_id" text,
	"base_revision" integer,
	"base_spec" jsonb,
	"spec" jsonb NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"max_risk" text NOT NULL,
	"inserted" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "builder_proposals" ADD CONSTRAINT "builder_proposals_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "public"."builder_conversations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_proposals" ADD CONSTRAINT "builder_proposals_workflow_fk" FOREIGN KEY ("org_id","workflow_id") REFERENCES "public"."workflows"("org_id","id") ON DELETE cascade ON UPDATE no action;