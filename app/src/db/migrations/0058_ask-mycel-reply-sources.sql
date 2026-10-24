-- Moved first by hand: the foreign keys below reference this key, so it must exist before them.
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_org_id_id_unique" UNIQUE("org_id","id");--> statement-breakpoint
CREATE TABLE "agent_message_connections" (
	"org_id" text NOT NULL,
	"message_id" text NOT NULL,
	"connection_id" text NOT NULL,
	CONSTRAINT "agent_message_connections_message_id_connection_id_pk" PRIMARY KEY("message_id","connection_id")
);
--> statement-breakpoint
CREATE TABLE "agent_message_facts" (
	"org_id" text NOT NULL,
	"message_id" text NOT NULL,
	"fact_id" text NOT NULL,
	CONSTRAINT "agent_message_facts_message_id_fact_id_pk" PRIMARY KEY("message_id","fact_id")
);
--> statement-breakpoint
ALTER TABLE "agent_message_connections" ADD CONSTRAINT "agent_message_connections_message_fk" FOREIGN KEY ("org_id","message_id") REFERENCES "public"."agent_messages"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_message_connections" ADD CONSTRAINT "agent_message_connections_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_message_facts" ADD CONSTRAINT "agent_message_facts_message_fk" FOREIGN KEY ("org_id","message_id") REFERENCES "public"."agent_messages"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_message_facts" ADD CONSTRAINT "agent_message_facts_fact_fk" FOREIGN KEY ("org_id","fact_id") REFERENCES "public"."facts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_message_connections_connection_id_idx" ON "agent_message_connections" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "agent_message_facts_fact_id_idx" ON "agent_message_facts" USING btree ("fact_id");