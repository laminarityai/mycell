// Capability requests (ADR-0018) and each time the builder chat asked for one. Both are
// tenant-owned and hold no connection_id: a request holds the agent's words and code draft,
// never source content (invariant 8), so disconnecting leaves them alone.
import { foreignKey, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
// An ask names the builder conversation it was filed from, which never leaves its org.
import { builderConversations } from "@/features/builder/lib/schema";
import type { CapabilityRequestField, CapabilityRequestStatus } from "../types";

/**
 * A capability request: unique per org on its app and operation (`key`, both normalized), so
 * asking again adds an ask, not a request. Its details are the latest ask's.
 */
export const capabilityRequests = pgTable(
  "capability_requests",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    // A registered app's ID, or the name the agent gave an app that isn't registered.
    app: text("app").notNull(),
    operation: text("operation").notNull(),
    // The app and operation, lowercased with spaces collapsed: what makes two asks one request.
    key: text("key").notNull(),
    inputs: jsonb("inputs").$type<CapabilityRequestField[]>().notNull(),
    outputs: jsonb("outputs").$type<CapabilityRequestField[]>().notNull(),
    reason: text("reason").notNull(),
    codeDraft: text("code_draft"),
    status: text("status", { enum: ["open", "building", "shipped", "declined"] })
      .$type<CapabilityRequestStatus>()
      .notNull()
      .default("open"),
    // Our team's note on the status, shown to the org's admins.
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("capability_requests_org_id_key_unique").on(table.orgId, table.key),
    unique("capability_requests_org_id_id_unique").on(table.orgId, table.id),
  ],
);

/** One time the builder chat asked for a request: the count is how many there are. */
export const capabilityRequestAsks = pgTable(
  "capability_request_asks",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    requestId: text("request_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    // The admin whose turn filed it; a plain user ID, like a conversation's starter.
    askedBy: text("asked_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "capability_request_asks_request_fk",
      columns: [table.orgId, table.requestId],
      foreignColumns: [capabilityRequests.orgId, capabilityRequests.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "capability_request_asks_conversation_fk",
      columns: [table.orgId, table.conversationId],
      foreignColumns: [builderConversations.orgId, builderConversations.id],
    }).onDelete("cascade"),
  ],
);
