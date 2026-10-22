// Memory's tables (ADR-0022, ADR-0023). Source records are the items memory learned from, each
// with the access list its app gave it; they and their access lists carry the connection's
// (org_id, connection_id) with a cascading foreign key (invariant 3). Objects and facts belong
// to the org, not to one connection: a fact is linked to every source record that supports it
// (`fact_sources`, which cascades from both), and the database removes a fact when its last
// link goes, and an object when no fact is about it or links to it (triggers in migration
// 0026). So whatever deletes a connection removes the facts only it supported, in the same
// transaction. No table holds source text (invariant 8): statements are short derived facts.
import { sql } from "drizzle-orm";
import {
  customType,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  vector,
} from "drizzle-orm/pg-core";
// The one table outside memory its tables reference: derived data cascades from its connection
// (docs/conventions.md, "Derived data cascades from its connection").
import { connections } from "@/features/connections/lib/schema";
import { MEMORY_APPS, OBJECT_KEY_KINDS, OBJECT_KINDS } from "../types";

/** The `embed` role's default model's dimensions (openai/text-embedding-3-small). */
export const EMBEDDING_DIMENSIONS = 1536;

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/**
 * One item memory learned from, as one connection holds it: an email (later a Drive file
 * version or a Calendar event). Copies of one item in several mailboxes are one record each,
 * sharing an item key.
 */
export const sourceRecords = pgTable(
  "source_records",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: text("connection_id").notNull(),
    // The connection's kind and owner (invariant 2): a member connection's records are its
    // owner's own, whoever else their access list names.
    ownerScope: text("owner_scope", { enum: ["member", "org"] }).notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    app: text("app", { enum: MEMORY_APPS }).notNull(),
    // How the item is re-fetched: the Gmail message ID.
    sourceRef: text("source_ref").notNull(),
    // The same for every copy of the item: an email's Message-ID header, lowercased.
    itemKey: text("item_key").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    // When its access list was last read from the app.
    accessCheckedAt: timestamp("access_checked_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Learning an item twice stores it once.
    unique("source_records_connection_id_app_source_ref_unique").on(
      table.connectionId,
      table.app,
      table.sourceRef,
    ),
    unique("source_records_org_id_id_unique").on(table.orgId, table.id),
    index("source_records_org_id_item_key_idx").on(table.orgId, table.itemKey),
    foreignKey({
      name: "source_records_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A source record's access list, one principal a row, copied from the app (ADR-0023): an
 * address (a person's or a group's), a domain, or anyone. An email's is everyone on it.
 */
export const accessListEntries = pgTable(
  "access_list_entries",
  {
    orgId: text("org_id").notNull(),
    connectionId: text("connection_id").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    kind: text("kind", { enum: ["address", "domain", "anyone"] }).notNull(),
    // A lowercased address or domain; empty for anyone.
    value: text("value").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceRecordId, table.kind, table.value] }),
    index("access_list_entries_org_id_kind_value_idx").on(table.orgId, table.kind, table.value),
    index("access_list_entries_connection_id_idx").on(table.connectionId),
    foreignKey({
      name: "access_list_entries_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "access_list_entries_source_record_fk",
      columns: [table.orgId, table.sourceRecordId],
      foreignColumns: [sourceRecords.orgId, sourceRecords.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A group address, such as all@, an admin marked company-wide (ADR-0023): email sent to it is
 * visible to everyone in the org. A setting of the org's, not derived from a connection.
 */
export const companyWideLists = pgTable(
  "company_wide_lists",
  {
    orgId: text("org_id").notNull(),
    // Lowercased, at the org's Workspace domain.
    address: text("address").notNull(),
    markedAt: timestamp("marked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.address] })],
);

/** A person, company, deal, project or document memory knows about. Never matched across orgs. */
export const memoryObjects = pgTable(
  "memory_objects",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    kind: text("kind", { enum: OBJECT_KINDS }).notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("memory_objects_org_id_id_unique").on(table.orgId, table.id)],
);

/** An exact identifier of an object, unique in its org: what exact matching matches on. */
export const objectKeys = pgTable(
  "object_keys",
  {
    orgId: text("org_id").notNull(),
    objectId: text("object_id").notNull(),
    kind: text("kind", { enum: OBJECT_KEY_KINDS }).notNull(),
    // Lowercased.
    value: text("value").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.kind, table.value] }),
    index("object_keys_object_id_idx").on(table.objectId),
    foreignKey({
      name: "object_keys_object_fk",
      columns: [table.orgId, table.objectId],
      foreignColumns: [memoryObjects.orgId, memoryObjects.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A short statement about an object (its subject) that a source states, or, from M9, that a
 * person told Mycel. Valid time (when it was true) and recorded time (when memory learned it,
 * and when a newer fact superseded it) are kept apart, as in Graphiti.
 */
export const facts = pgTable(
  "facts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    subjectId: text("subject_id").notNull(),
    statement: text("statement").notNull(),
    predicate: text("predicate"),
    value: text("value"),
    // The other object it links the subject to, if any.
    objectId: text("object_id"),
    // `source`: learned from source records. `told_by`: a person told Mycel (M9, unused yet).
    origin: text("origin", { enum: ["source", "told_by"] }).notNull(),
    toldByUserId: text("told_by_user_id"),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
    // Set when a newer fact replaced it; it stays as history meanwhile.
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    supersededById: text("superseded_by_id"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    // The keyword index's document, derived from the statement by Postgres.
    keywords: tsvector("keywords")
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('english', statement)`),
  },
  (table) => [
    unique("facts_org_id_id_unique").on(table.orgId, table.id),
    index("facts_org_id_subject_id_idx").on(table.orgId, table.subjectId),
    index("facts_object_id_idx").on(table.objectId),
    index("facts_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    index("facts_keywords_idx").using("gin", table.keywords),
    foreignKey({
      name: "facts_subject_fk",
      columns: [table.orgId, table.subjectId],
      foreignColumns: [memoryObjects.orgId, memoryObjects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "facts_object_fk",
      columns: [table.orgId, table.objectId],
      foreignColumns: [memoryObjects.orgId, memoryObjects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "facts_superseded_by_fk",
      columns: [table.supersededById],
      foreignColumns: [table.id],
    }).onDelete("set null"),
  ],
);

/** Which source records support a fact. A fact is visible to anyone who can see one of them. */
export const factSources = pgTable(
  "fact_sources",
  {
    orgId: text("org_id").notNull(),
    connectionId: text("connection_id").notNull(),
    factId: text("fact_id").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.factId, table.sourceRecordId] }),
    index("fact_sources_source_record_id_idx").on(table.sourceRecordId),
    index("fact_sources_connection_id_idx").on(table.connectionId),
    foreignKey({
      name: "fact_sources_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fact_sources_fact_fk",
      columns: [table.orgId, table.factId],
      foreignColumns: [facts.orgId, facts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fact_sources_source_record_fk",
      columns: [table.orgId, table.sourceRecordId],
      foreignColumns: [sourceRecords.orgId, sourceRecords.id],
    }).onDelete("cascade"),
  ],
);
