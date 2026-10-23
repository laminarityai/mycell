// Connections, where each ingested app stands on them, and the connect attempts that lead to
// them. All three tables are tenant-owned.
import "server-only";
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { member } from "@/db/auth-schema";

/**
 * One Nango connection to one account in a registered app: a Google account (or, from before
 * ADR-0014, one of its apps), or an account in another registered app such as Microsoft 365.
 * One per account and app.
 * The owner has no foreign key to `member`: an org connection outlives the admin who made it,
 * so member connections are deleted explicitly when their owner is removed.
 */
export const connections = pgTable(
  "connections",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    kind: text("kind", { enum: ["member", "org"] }).notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    source: text("source", { enum: ["google", "microsoft", "gmail", "drive"] }).notNull(),
    // The connected account's address, lowercased.
    accountEmail: text("account_email").notNull(),
    nangoConnectionId: text("nango_connection_id").notNull().unique(),
    // The OAuth scopes the app granted, read from Nango when the connection is recorded and on
    // every reconnect. Empty for a one-app connection not reconnected since ADR-0014.
    grantedScopes: text("granted_scopes").array().notNull().default([]),
    // Set when Nango reports the app refused to refresh the token, cleared by a reconnect or a
    // later successful refresh. Polling skips the connection meanwhile.
    needsReauth: boolean("needs_reauth").notNull().default(false),
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
 * Where one ingested app (Gmail, Drive) stands on a connection: one row per app the connection
 * may use, set by discovery's ingest. Deleted with its connection, or when a reconnect leaves
 * its app out.
 */
export const ingestStates = pgTable(
  "ingest_states",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: text("connection_id").notNull(),
    app: text("app", { enum: ["gmail", "drive"] }).notNull(),
    // Backfilling until the app's first backfill ends, then active (or failed).
    status: text("status", { enum: ["backfilling", "active", "failed"] }).notNull(),
    // Messages (or file changes) the current backfill has stored so far.
    backfilledItems: integer("backfilled_items").notNull().default(0),
    // Where polling resumes in the app: Gmail's history ID, or Drive's changes page token.
    // Null until a backfill starts.
    cursor: text("cursor"),
    // When polling last finished for the app. Null until the first poll.
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    // When the app's watch on the account runs out (ADR-0026), as the app answered the last
    // watch or renewal. Null until a watch starts; it stays as it was when a renewal fails.
    watchExpiresAt: timestamp("watch_expires_at", { withTimezone: true }),
    // The channel the app's watch opened, for an app whose watch is a web-hook channel (Drive's):
    // its ID and the resource ID the app gave it, which stopping it needs. Null for Gmail's.
    watchChannelId: text("watch_channel_id"),
    watchResourceId: text("watch_resource_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("ingest_states_connection_id_app_unique").on(table.connectionId, table.app),
    foreignKey({
      name: "ingest_states_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
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
    source: text("source", { enum: ["google", "microsoft", "gmail", "drive"] }).notNull(),
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
