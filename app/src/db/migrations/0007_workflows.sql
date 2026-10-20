CREATE TABLE "workflow_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"number" integer NOT NULL,
	"spec" jsonb NOT NULL,
	"max_risk" text NOT NULL,
	"required_actions" jsonb NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_versions_workflow_id_number_unique" UNIQUE("workflow_id","number"),
	CONSTRAINT "workflow_versions_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"spec_id" text NOT NULL,
	"working_spec" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_org_id_spec_id_unique" UNIQUE("org_id","spec_id"),
	CONSTRAINT "workflows_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_fk" FOREIGN KEY ("org_id","workflow_id") REFERENCES "public"."workflows"("org_id","id") ON DELETE cascade ON UPDATE no action;