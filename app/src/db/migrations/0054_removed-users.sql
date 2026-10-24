CREATE TABLE "removed_users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"removed_by" text NOT NULL,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "removed_users_org_id_user_id_unique" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "removed_users" ADD CONSTRAINT "removed_users_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "removed_users_org_id_email_idx" ON "removed_users" USING btree ("org_id","email");