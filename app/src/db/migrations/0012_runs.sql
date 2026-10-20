CREATE TABLE "run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"run_id" text NOT NULL,
	"position" integer NOT NULL,
	"step_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer NOT NULL,
	"output" jsonb,
	"error_code" text,
	"error_message" text,
	"model_role" text,
	"model_id" text,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp NOT NULL,
	CONSTRAINT "run_steps_run_id_step_id_unique" UNIQUE("run_id","step_id")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"owner_scope" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_version_id" text NOT NULL,
	"enablement_id" text,
	"source_ref" text NOT NULL,
	"status" text NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	CONSTRAINT "runs_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_fk" FOREIGN KEY ("org_id","run_id") REFERENCES "public"."runs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workflow_version_fk" FOREIGN KEY ("org_id","workflow_version_id") REFERENCES "public"."workflow_versions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_org_id_workflow_id_idx" ON "runs" USING btree ("org_id","workflow_id");