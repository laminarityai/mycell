// The outbox (ADR-0027): the Inngest events a change sends, written in the change's own
// transaction, so neither is saved without the other. Each row waits here until Inngest has its
// event: the action that wrote it sends it right after the commit, and the outbox job sends what
// that left. Data are IDs and names, never content (invariant 8).
import "server-only";
import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { z } from "zod";
import { zodJsonb } from "@/db/columns";

export const outbox = pgTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    // The event's name, its data (checked by the event's own schema when written and sent), and
    // its fixed ID, which makes the action's send and the job's one event to Inngest.
    name: text("name").notNull(),
    data: zodJsonb("data", z.record(z.string(), z.unknown())).notNull(),
    eventId: text("event_id").notNull(),
    writtenAt: timestamp("written_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // An event written again while it waits is the same event: it waits once.
    unique("outbox_org_id_event_id_unique").on(table.orgId, table.eventId),
    // The job reads an org's waiting events, oldest first.
    index("outbox_org_id_written_at_idx").on(table.orgId, table.writtenAt),
  ],
);
