CREATE TABLE "enablements" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"status" text DEFAULT 'on' NOT NULL,
	"enabled_at" timestamp NOT NULL,
	CONSTRAINT "enablements_workflow_id_user_id_unique" UNIQUE("workflow_id","user_id"),
	CONSTRAINT "enablements_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "started_by" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "trigger_key" text;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "org_connection_id" text;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "org_switched_on_at" timestamp;--> statement-breakpoint
ALTER TABLE "enablements" ADD CONSTRAINT "enablements_workflow_fk" FOREIGN KEY ("org_id","workflow_id") REFERENCES "public"."workflows"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enablements" ADD CONSTRAINT "enablements_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enablements" ADD CONSTRAINT "enablements_member_fk" FOREIGN KEY ("org_id","user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_enablement_fk" FOREIGN KEY ("enablement_id") REFERENCES "public"."enablements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_org_connection_fk" FOREIGN KEY ("org_connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_org_id_trigger_key_unique" UNIQUE("org_id","trigger_key");