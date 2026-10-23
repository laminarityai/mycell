CREATE TABLE "held_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"custom_action" text NOT NULL,
	"request" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "held_sends_org_id_run_id_step_id_unique" UNIQUE("org_id","run_id","step_id")
);
--> statement-breakpoint
ALTER TABLE "held_sends" ADD CONSTRAINT "held_sends_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_sends" ADD CONSTRAINT "held_sends_run_fk" FOREIGN KEY ("org_id","run_id") REFERENCES "public"."runs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_sends" ADD CONSTRAINT "held_sends_custom_action_fk" FOREIGN KEY ("org_id","custom_action") REFERENCES "public"."custom_actions"("org_id","name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "held_sends_org_id_created_at_idx" ON "held_sends" USING btree ("org_id","created_at");