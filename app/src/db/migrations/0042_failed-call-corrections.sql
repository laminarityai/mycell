ALTER TABLE "credit_ledger" ADD COLUMN "corrects_id" text;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_corrects_id_fk" FOREIGN KEY ("corrects_id") REFERENCES "public"."credit_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_corrects_id_unique" ON "credit_ledger" USING btree ("corrects_id");