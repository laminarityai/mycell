CREATE TABLE "capability_request_asks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"request_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"asked_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"app" text NOT NULL,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"outputs" jsonb NOT NULL,
	"reason" text NOT NULL,
	"code_draft" text,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_requests_org_id_key_unique" UNIQUE("org_id","key"),
	CONSTRAINT "capability_requests_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "capability_request_asks" ADD CONSTRAINT "capability_request_asks_request_fk" FOREIGN KEY ("org_id","request_id") REFERENCES "public"."capability_requests"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_request_asks" ADD CONSTRAINT "capability_request_asks_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "public"."builder_conversations"("org_id","id") ON DELETE cascade ON UPDATE no action;