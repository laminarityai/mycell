-- A review goes with its run's own connection too (invariant 3): for a held send that's the
-- run's Gmail connection, not the app connection the review is on. Existing rows take their
-- run's connection, or their own where the run is gone.
ALTER TABLE "reviews" ADD COLUMN "run_connection_id" text;--> statement-breakpoint
UPDATE "reviews" SET "run_connection_id" = COALESCE(
	(SELECT "runs"."connection_id" FROM "runs" WHERE "runs"."org_id" = "reviews"."org_id" AND "runs"."id" = "reviews"."run_id"),
	"reviews"."connection_id"
);--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "run_connection_id" SET NOT NULL;--> statement-breakpoint
-- A held send carries its run's provenance (invariant 2) and its review.
ALTER TABLE "held_sends" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "held_sends" ADD COLUMN "owner_scope" text;--> statement-breakpoint
ALTER TABLE "held_sends" ADD COLUMN "review_id" text;--> statement-breakpoint
UPDATE "held_sends" SET "source_ref" = "runs"."source_ref", "owner_scope" = "runs"."owner_scope"
FROM "runs" WHERE "runs"."org_id" = "held_sends"."org_id" AND "runs"."id" = "held_sends"."run_id";--> statement-breakpoint
UPDATE "held_sends" SET "review_id" = "reviews"."id"
FROM "reviews" WHERE "reviews"."org_id" = "held_sends"."org_id" AND "reviews"."kind" = 'held_send' AND "reviews"."item_ref" = "held_sends"."id";--> statement-breakpoint
ALTER TABLE "held_sends" ALTER COLUMN "source_ref" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "held_sends" ALTER COLUMN "owner_scope" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_run_connection_fk" FOREIGN KEY ("org_id","run_connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_sends" ADD CONSTRAINT "held_sends_review_fk" FOREIGN KEY ("org_id","review_id") REFERENCES "public"."reviews"("org_id","id") ON DELETE cascade ON UPDATE no action;
