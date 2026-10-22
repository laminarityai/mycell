CREATE TABLE "access_list_entries" (
	"org_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"source_record_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "access_list_entries_source_record_id_kind_value_pk" PRIMARY KEY("source_record_id","kind","value")
);
--> statement-breakpoint
CREATE TABLE "fact_sources" (
	"org_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"fact_id" text NOT NULL,
	"source_record_id" text NOT NULL,
	CONSTRAINT "fact_sources_fact_id_source_record_id_pk" PRIMARY KEY("fact_id","source_record_id")
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"statement" text NOT NULL,
	"predicate" text,
	"value" text,
	"object_id" text,
	"origin" text NOT NULL,
	"told_by_user_id" text,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"superseded_by_id" text,
	"embedding" vector(1536) NOT NULL,
	"keywords" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', statement)) STORED NOT NULL,
	CONSTRAINT "facts_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "memory_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_objects_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "object_keys" (
	"org_id" text NOT NULL,
	"object_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "object_keys_org_id_kind_value_pk" PRIMARY KEY("org_id","kind","value")
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"owner_scope" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"app" text NOT NULL,
	"source_ref" text NOT NULL,
	"item_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"access_checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_records_connection_id_app_source_ref_unique" UNIQUE("connection_id","app","source_ref"),
	CONSTRAINT "source_records_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "access_list_entries" ADD CONSTRAINT "access_list_entries_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_list_entries" ADD CONSTRAINT "access_list_entries_source_record_fk" FOREIGN KEY ("org_id","source_record_id") REFERENCES "public"."source_records"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_fact_fk" FOREIGN KEY ("org_id","fact_id") REFERENCES "public"."facts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_source_record_fk" FOREIGN KEY ("org_id","source_record_id") REFERENCES "public"."source_records"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_subject_fk" FOREIGN KEY ("org_id","subject_id") REFERENCES "public"."memory_objects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_object_fk" FOREIGN KEY ("org_id","object_id") REFERENCES "public"."memory_objects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_superseded_by_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_keys" ADD CONSTRAINT "object_keys_object_fk" FOREIGN KEY ("org_id","object_id") REFERENCES "public"."memory_objects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_list_entries_org_id_kind_value_idx" ON "access_list_entries" USING btree ("org_id","kind","value");--> statement-breakpoint
CREATE INDEX "access_list_entries_connection_id_idx" ON "access_list_entries" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "fact_sources_source_record_id_idx" ON "fact_sources" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX "fact_sources_connection_id_idx" ON "fact_sources" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "facts_org_id_subject_id_idx" ON "facts" USING btree ("org_id","subject_id");--> statement-breakpoint
CREATE INDEX "facts_object_id_idx" ON "facts" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "facts_embedding_idx" ON "facts" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "facts_keywords_idx" ON "facts" USING gin ("keywords");--> statement-breakpoint
CREATE INDEX "object_keys_object_id_idx" ON "object_keys" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "source_records_org_id_item_key_idx" ON "source_records" USING btree ("org_id","item_key");