CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric NOT NULL,
	"role" text,
	"model_id" text,
	"outcome" text,
	"cost_usd" numeric,
	"generation_id" text,
	"workflow_id" text,
	"run_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_roles" (
	"org_id" text NOT NULL,
	"role" text NOT NULL,
	"model_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "model_roles_org_id_role_pk" PRIMARY KEY("org_id","role")
);
--> statement-breakpoint
CREATE INDEX "credit_ledger_org_id_idx" ON "credit_ledger" USING btree ("org_id");