ALTER TABLE "access_list_entries" ADD COLUMN "confirmed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "conflicts_with_id" text;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "from_inside" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- What emails learned before this said about who was on them came from their headers, which
-- their senders wrote: none of it is confirmed. Their mailboxes' own copies still count.
UPDATE "access_list_entries" SET "confirmed" = false
FROM "source_records"
WHERE "source_records"."org_id" = "access_list_entries"."org_id"
  AND "source_records"."id" = "access_list_entries"."source_record_id"
  AND "source_records"."app" = 'gmail';
