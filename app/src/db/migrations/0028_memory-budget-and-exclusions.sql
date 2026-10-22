CREATE TABLE "memory_exclusions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_exclusions_org_id_kind_value_unique" UNIQUE("org_id","kind","value")
);
--> statement-breakpoint
CREATE TABLE "memory_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"monthly_budget" numeric NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"started_by_user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_postponed_items" (
	"org_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"app" text NOT NULL,
	"source_ref" text NOT NULL,
	"postponed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_postponed_items_connection_id_app_source_ref_pk" PRIMARY KEY("connection_id","app","source_ref")
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "memory_postponed_items" ADD CONSTRAINT "memory_postponed_items_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_postponed_items_org_id_idx" ON "memory_postponed_items" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_org_id_purpose_created_at_idx" ON "credit_ledger" USING btree ("org_id","purpose","created_at");