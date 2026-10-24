CREATE TABLE "agent_pending_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"owner_scope" text DEFAULT 'member' NOT NULL,
	"source_ref" text NOT NULL,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_pending_runs" ADD CONSTRAINT "agent_pending_runs_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "public"."agent_conversations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_pending_runs" ADD CONSTRAINT "agent_pending_runs_workflow_fk" FOREIGN KEY ("org_id","workflow_id") REFERENCES "public"."workflows"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_pending_runs" ADD CONSTRAINT "agent_pending_runs_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_pending_runs_org_id_conversation_id_idx" ON "agent_pending_runs" USING btree ("org_id","conversation_id");--> statement-breakpoint
CREATE INDEX "agent_pending_runs_org_id_workflow_id_idx" ON "agent_pending_runs" USING btree ("org_id","workflow_id");--> statement-breakpoint
CREATE INDEX "agent_pending_runs_org_id_connection_id_idx" ON "agent_pending_runs" USING btree ("org_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_agent_running_unique" ON "runs" USING btree ("org_id","workflow_id","connection_id","source_ref") WHERE "runs"."started_by" = 'agent' and "runs"."status" = 'running';