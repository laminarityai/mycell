// Connections and the connect attempts that lead to them. Both tables are tenant-owned.
import { foreignKey, index, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { member } from "@/db/auth-schema";

/**
 * One Nango connection to one source. The owner has no foreign key to `member`: an org
 * connection outlives the admin who made it, so member connections are deleted explicitly when
 * their owner is removed.
 */
export const connections = pgTable(
  "connections",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    kind: text("kind", { enum: ["member", "org"] }).notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    source: text("source", { enum: ["gmail"] }).notNull(),
    // The connected Google account, lowercased.
    accountEmail: text("account_email").notNull(),
    nangoConnectionId: text("nango_connection_id").notNull().unique(),
    // Set by discovery's ingest: backfilling until the first backfill ends, then active (or
    // failed). See ConnectionStatus.
    status: text("status", { enum: ["backfilling", "active", "failed"] }).notNull(),
    // Messages (or files) the current backfill has stored so far.
    backfilledItems: integer("backfilled_items").notNull().default(0),
    // Where polling resumes in the source: Gmail's history ID. Null until a backfill starts.
    cursor: text("cursor"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("connections_org_id_source_account_unique").on(
      table.orgId,
      table.source,
      table.accountEmail,
    ),
    // Derived tables reference a connection as (org_id, connection_id).
    unique("connections_org_id_id_unique").on(table.orgId, table.id),
  ],
);

/**
 * A connect attempt: started when a user opens Nango's Connect UI, settled by Nango's creation
 * webhook. Its ID is the Nango end-user ID, which is how the webhook finds it.
 */
export const connectAttempts = pgTable(
  "connect_attempts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind", { enum: ["member", "org"] }).notNull(),
    source: text("source", { enum: ["gmail"] }).notNull(),
    status: text("status", { enum: ["pending", "connected", "refused"] }).notNull(),
    refusal: text("refusal"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("connect_attempts_org_id_user_id_idx").on(table.orgId, table.userId),
    // Removing a user deletes their member row, and with it their unfinished attempts.
    foreignKey({
      name: "connect_attempts_member_fk",
      columns: [table.orgId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
    }).onDelete("cascade"),
  ],
);
