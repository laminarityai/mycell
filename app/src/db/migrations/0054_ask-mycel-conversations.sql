CREATE TABLE "agent_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_conversations_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"seq" bigserial NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_member_fk" FOREIGN KEY ("org_id","owner_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "public"."agent_conversations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_conversations_org_id_owner_user_id_updated_at_idx" ON "agent_conversations" USING btree ("org_id","owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "agent_messages_org_id_conversation_id_idx" ON "agent_messages" USING btree ("org_id","conversation_id");