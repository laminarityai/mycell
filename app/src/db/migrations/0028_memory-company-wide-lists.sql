CREATE TABLE "company_wide_lists" (
	"org_id" text NOT NULL,
	"address" text NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_wide_lists_org_id_address_pk" PRIMARY KEY("org_id","address")
);
