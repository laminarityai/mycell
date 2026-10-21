CREATE TABLE "workflow_version_tags" (
	"org_id" text NOT NULL,
	"workflow_version_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "workflow_version_tags_workflow_version_id_tag_id_pk" PRIMARY KEY("workflow_version_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "workflow_version_tags" ADD CONSTRAINT "workflow_version_tags_version_fk" FOREIGN KEY ("org_id","workflow_version_id") REFERENCES "public"."workflow_versions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_version_tags" ADD CONSTRAINT "workflow_version_tags_tag_fk" FOREIGN KEY ("org_id","tag_id") REFERENCES "public"."tags"("org_id","id") ON DELETE cascade ON UPDATE no action;