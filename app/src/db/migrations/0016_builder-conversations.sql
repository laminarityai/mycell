CREATE TABLE "builder_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"started_by" text NOT NULL,
	"workflow_id" text,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "builder_conversations_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "builder_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"seq" bigserial NOT NULL,
	"role" text NOT NULL,
	"author_id" text,
	"parts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "builder_conversations" ADD CONSTRAINT "builder_conversations_workflow_fk" FOREIGN KEY ("org_id","workflow_id") REFERENCES "public"."workflows"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_messages" ADD CONSTRAINT "builder_messages_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "public"."builder_conversations"("org_id","id") ON DELETE cascade ON UPDATE no action;