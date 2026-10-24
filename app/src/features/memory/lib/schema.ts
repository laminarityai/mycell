// Memory's tables (ADR-0022, ADR-0023). Source records are the items memory learned from, each
// with the access list its app gave it; they and their access lists carry the connection's
// (org_id, connection_id) with a cascading foreign key (invariant 3). Objects and facts belong
// to the org, not to one connection: a fact is linked to every source record that supports it
// (`fact_sources`, which cascades from both), and the database removes a fact when its last
// link goes, and an object when no fact is about it or links to it (triggers in migration
// 0026). So whatever deletes a connection removes the facts only it supported, in the same
// transaction. No table holds source text (invariant 8): statements are short derived facts.
import "server-only";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  vector,
} from "drizzle-orm/pg-core";
// Derived data cascades from its connection (docs/conventions.md, "Derived data cascades from
// its connection").
import { connections } from "@/features/connections/lib/schema";
// A told fact references its teller as a member, so it goes when they're removed.
import { member } from "@/db/auth-schema";
import {
  ACCESS_LOG_READER_KINDS,
  EXCLUSION_KINDS,
  MAX_RETENTION_MONTHS,
  MEMORY_APPS,
  MEMORY_READ_OPERATIONS,
  OBJECT_KEY_KINDS,
  POSTPONE_REASONS,
  OBJECT_KINDS,
} from "../types";

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
    // Whether it came from inside the company, as Mycel saw: an email one of the company's
    // connected mailboxes sent, or a doc a colleague owns. A fact stated only from outside never
    // supersedes one from inside or a company-wide one (`supersede.ts`).
    fromInside: boolean("from_inside").notNull().default(false),
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
 * A source record's access list, one principal a row (ADR-0023): an address (a person's or a
 * group's), a domain, or anyone. Only confirmed entries widen who sees the record: a doc's
 * sharing list as Drive gives it, the mailbox that holds an email, and everyone on an email
 * that mailbox sent. The rest of an email's addresses are what its sender wrote in its headers,
 * kept unconfirmed for exclusions only: anyone can write any address there.
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
    // Whether Mycel saw that the principal may see the item, rather than its sender saying so.
    confirmed: boolean("confirmed").notNull().default(true),
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
  (table) => [
    unique("memory_objects_org_id_id_unique").on(table.orgId, table.id),
    // Matching's name candidates (`%`, trigram similarity; pg_trgm, migration 0030).
    index("memory_objects_name_trgm_idx").using("gin", table.name.op("gin_trgm_ops")),
  ],
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
    // `source`: learned from source records. `told_by`: a person told Mycel ("remember this",
    // M9), seen only by its teller (`told_by_user_id`), with no source records.
    origin: text("origin", { enum: ["source", "told_by"] }).notNull(),
    toldByUserId: text("told_by_user_id"),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
    // Set when a newer fact replaced it; it stays as history meanwhile.
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    supersededById: text("superseded_by_id"),
    // For a fact stated only from outside the company: the fact from inside, or company-wide,
    // that it contradicts but couldn't supersede, so both stay current. No foreign key: a fact
    // it names that's gone is no conflict.
    conflictsWithId: text("conflicts_with_id"),
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
    // `superseded_by_id` has no foreign key: when the fact it points to is deleted, a trigger
    // (migration 0032) points it at that fact's own replacement, or makes it current again.
    index("facts_superseded_by_id_idx").on(table.supersededById),
    // A told fact has its teller, and only a told fact has one.
    check(
      "facts_told_by_user_when_told",
      sql`(${table.origin} = 'told_by') = (${table.toldByUserId} is not null)`,
    ),
    // Removing a member deletes their member row, and with it what they told Mycel.
    foreignKey({
      name: "facts_told_by_member_fk",
      columns: [table.orgId, table.toldByUserId],
      foreignColumns: [member.organizationId, member.userId],
    }).onDelete("cascade"),
    // A teller's own facts: their timelines, and the list of what they told Mycel.
    index("facts_org_id_told_by_user_id_idx").on(table.orgId, table.toldByUserId),
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

/**
 * Memory's settings for an org, one row once an admin confirmed the estimate and started it:
 * nothing is learned before then. The monthly budget caps the credits learning spends, and the
 * retention window how long memory keeps what a source taught (ADR-0024).
 */
export const memorySettings = pgTable("memory_settings", {
  orgId: text("org_id").primaryKey(),
  // Credits a calendar month (UTC) of learning may spend.
  monthlyBudget: numeric("monthly_budget", { mode: "number" }).notNull(),
  // Source records older than this many months are deleted nightly, with what only they taught.
  retentionMonths: integer("retention_months").notNull().default(MAX_RETENTION_MONTHS),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  // The admin who confirmed the estimate, or `system` for our team's scripts.
  startedByUserId: text("started_by_user_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Something an admin keeps out of memory for the whole company (ADR-0023): a Gmail label (by
 * name, since each mailbox has its own label IDs), a Drive folder (by ID), an address or a
 * domain. Settings, not data from a connection.
 */
export const exclusions = pgTable(
  "memory_exclusions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    kind: text("kind", { enum: EXCLUSION_KINDS }).notNull(),
    // A label's name as the admin typed it; a lowercased address or domain; a folder ID.
    value: text("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("memory_exclusions_org_id_kind_value_unique").on(table.orgId, table.kind, table.value),
  ],
);

/**
 * The do-not-learn list (ADR-0024): the people an admin asked memory to forget, each as a keyed
 * hash of their address under the org's hashing key (the key store), never the address itself.
 * New mail is checked by hashing its addresses the same way. An org setting, with no connection.
 */
export const doNotLearn = pgTable(
  "memory_do_not_learn",
  {
    orgId: text("org_id").notNull(),
    addressHash: text("address_hash").notNull(),
    forgottenAt: timestamp("forgotten_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.addressHash] })],
);

/**
 * The access log (ADR-0024): one row per read of memory, saying who or what read, when, and
 * which objects and facts, by ID only: never the query or what a fact says. It isn't derived
 * from any connection, so it has none and outlives the facts it names, for
 * ACCESS_LOG_RETENTION_DAYS. Its IDs are plain: a reader leaving the org or a fact going leaves
 * the entry as it was.
 */
export const accessLogEntries = pgTable(
  "access_log_entries",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
    operation: text("operation", { enum: MEMORY_READ_OPERATIONS }).notNull(),
    readerKind: text("reader_kind", { enum: ACCESS_LOG_READER_KINDS }).notNull(),
    // The person whose view was read (see AccessLogEntry); null for the system ctx.
    userId: text("user_id"),
    runId: text("run_id"),
    workflowId: text("workflow_id"),
    staffConsentId: text("staff_consent_id"),
    objectIds: text("object_ids").array().notNull(),
    factIds: text("fact_ids").array().notNull(),
    // Whose member connections held a source of a fact read, when it was read: the members who
    // see this entry.
    sourceOwnerIds: text("source_owner_ids").array().notNull(),
  },
  (table) => [
    index("access_log_entries_org_id_read_at_idx").on(table.orgId, table.readAt),
    index("access_log_entries_source_owner_ids_idx").using("gin", table.sourceOwnerIds),
  ],
);

/**
 * An item memory put off learning, and why: the month's budget was spent (learned when the next
 * month starts or the budget changes), the org ran out of credits (when credits are granted), or
 * the injection screen kept failing (tried hourly). A pointer only, cascading from its
 * connection (invariant 3).
 */
export const postponedItems = pgTable(
  "memory_postponed_items",
  {
    orgId: text("org_id").notNull(),
    connectionId: text("connection_id").notNull(),
    app: text("app", { enum: MEMORY_APPS }).notNull(),
    sourceRef: text("source_ref").notNull(),
    reason: text("reason", { enum: POSTPONE_REASONS }).notNull().default("budget"),
    postponedAt: timestamp("postponed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.app, table.sourceRef] }),
    index("memory_postponed_items_org_id_idx").on(table.orgId),
    foreignKey({
      name: "memory_postponed_items_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
  ],
);

/**
 * An admin's consent for one of our staff to read memory for one case, until it expires or the
 * admin revokes it (ADR-0024). Kept, revoked or expired, while log entries may name it, and
 * after its admin leaves the org (a plain user ID), though it then lets no one read.
 */
export const staffConsents = pgTable(
  "staff_consents",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    grantedByUserId: text("granted_by_user_id").notNull(),
    staffEmail: text("staff_email").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("staff_consents_org_id_idx").on(table.orgId)],
);
