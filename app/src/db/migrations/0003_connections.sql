CREATE TABLE "connect_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"refusal" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"source" text NOT NULL,
	"account_email" text NOT NULL,
	"nango_connection_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "connections_nango_connection_id_unique" UNIQUE("nango_connection_id"),
	CONSTRAINT "connections_org_id_source_account_unique" UNIQUE("org_id","source","account_email"),
	CONSTRAINT "connections_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "connect_attempts" ADD CONSTRAINT "connect_attempts_member_fk" FOREIGN KEY ("org_id","user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connect_attempts_org_id_user_id_idx" ON "connect_attempts" USING btree ("org_id","user_id");