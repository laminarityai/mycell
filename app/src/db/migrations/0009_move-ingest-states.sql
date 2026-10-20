-- Moves each existing one-app connection's ingest state (status, cursor, progress, last poll)
-- into ingest_states, under the app its source names, and keeps `needs_reauth` on the
-- connection itself (ADR-0014). The next migration drops the old columns.
INSERT INTO "ingest_states" ("id", "org_id", "connection_id", "app", "status", "backfilled_items", "cursor", "last_polled_at", "created_at")
SELECT
	gen_random_uuid()::text,
	"org_id",
	"id",
	"source",
	-- A connection waiting on a reconnect kept its app's ingest state; it comes back active.
	CASE WHEN "status" = 'needs_reauth' THEN 'active' ELSE "status" END,
	"backfilled_items",
	"cursor",
	"last_polled_at",
	"created_at"
FROM "connections"
WHERE "source" IN ('gmail', 'drive');
--> statement-breakpoint
UPDATE "connections" SET "needs_reauth" = true WHERE "status" = 'needs_reauth';
