ALTER TABLE "runs" ADD COLUMN "retry_of_run_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_retry_of_fk" FOREIGN KEY ("retry_of_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_retry_of_run_id_unique" UNIQUE("retry_of_run_id");