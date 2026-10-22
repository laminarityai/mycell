CREATE TABLE "memory_do_not_learn" (
	"org_id" text NOT NULL,
	"address_hash" text NOT NULL,
	"forgotten_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_do_not_learn_org_id_address_hash_pk" PRIMARY KEY("org_id","address_hash")
);
--> statement-breakpoint
ALTER TABLE "memory_settings" ADD COLUMN "retention_months" integer DEFAULT 24 NOT NULL;