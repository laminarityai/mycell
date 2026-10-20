// Events and their object refs: what ingest derives from a connection. Both carry the
// connection's (org_id, connection_id) with a cascading foreign key, so deleting the connection
// deletes them (invariant 3). Neither holds content: no subject, body, snippet or file name
// (invariant 8). `source_ref` is how content is re-fetched.
import { foreignKey, index, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
// The one table outside discovery its tables reference: derived data cascades from its
// connection (docs/conventions.md, "Derived data cascades from its connection").
import { connections } from "@/features/connections/lib/schema";
import { EVENT_TYPES, type AttachmentMeta } from "../types";

/** One normalized thing that happened in a source: a Gmail message, or a Drive file change. */
export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: text("connection_id").notNull(),
    // The connection's kind: `member` data is its owner's alone, `org` data is admins'.
    ownerScope: text("owner_scope", { enum: ["member", "org"] }).notNull(),
    // The user who made the connection, so a member scope can be checked without it.
    ownerUserId: text("owner_user_id").notNull(),
    source: text("source", { enum: ["gmail", "drive"] }).notNull(),
    // The Gmail message ID, or the Drive file ID and modified time (`<id>@<RFC 3339 time>`).
    sourceRef: text("source_ref").notNull(),
    type: text("type", { enum: EVENT_TYPES }).notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
    // Lowercased addresses: who acted, and everyone else involved.
    actor: text("actor"),
    counterparties: text("counterparties").array().notNull(),
    // Null for a file change, which goes no way.
    direction: text("direction", { enum: ["inbound", "outbound"] }),
    threadId: text("thread_id"),
    attachments: jsonb("attachments").$type<AttachmentMeta[]>().notNull(),
    labelIds: text("label_ids").array().notNull(),
    // A Drive file's MIME type; null for an email.
    mimeType: text("mime_type"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Re-running a backfill or a poll stores nothing twice.
    unique("events_connection_id_source_ref_unique").on(table.connectionId, table.sourceRef),
    unique("events_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      name: "events_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
  ],
);

/** A deterministic link from an event to an object, on an exact key (ADR-0008). */
export const objectRefs = pgTable(
  "object_refs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: text("connection_id").notNull(),
    eventId: text("event_id").notNull(),
    kind: text("kind", { enum: ["email", "drive_file"] }).notNull(),
    key: text("key").notNull(),
  },
  (table) => [
    index("object_refs_org_id_kind_key_idx").on(table.orgId, table.kind, table.key),
    // Lets deleting a connection find its refs without a scan.
    index("object_refs_connection_id_idx").on(table.connectionId),
    unique("object_refs_event_id_kind_key_unique").on(table.eventId, table.kind, table.key),
    foreignKey({
      name: "object_refs_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "object_refs_event_fk",
      columns: [table.orgId, table.eventId],
      foreignColumns: [events.orgId, events.id],
    }).onDelete("cascade"),
  ],
);
