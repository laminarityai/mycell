ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_userId_unique" UNIQUE("organization_id","user_id");--> statement-breakpoint
CREATE TABLE "tag_assignments" (
	"org_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tag_assignments_tag_id_user_id_pk" PRIMARY KEY("tag_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tags_org_id_name_unique" UNIQUE("org_id","name"),
	CONSTRAINT "tags_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "tag_assignments" ADD CONSTRAINT "tag_assignments_tag_fk" FOREIGN KEY ("org_id","tag_id") REFERENCES "public"."tags"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_assignments" ADD CONSTRAINT "tag_assignments_member_fk" FOREIGN KEY ("org_id","user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;
