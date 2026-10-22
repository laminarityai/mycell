// A company's custom actions, its capability requests (ADR-0018), and each time the builder chat
// asked for one. All are tenant-owned and hold no connection_id: a custom action describes a
// call and outlives the connections it runs through, and a request holds the agent's words and
// code draft; none holds source content (invariant 8), so disconnecting leaves them alone.
import { foreignKey, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { z } from "zod";
import { zodJsonb } from "@/db/columns";
// An ask names the builder conversation it was filed from, which never leaves its org.
import { builderConversations } from "@/features/builder/lib/schema";
import type { RiskLevel } from "@/features/policy/types";
import {
  capabilityRequestFieldSchema,
  customActionDescriptionSchema,
  type CapabilityRequestStatus,
} from "../types";

/**
 * A custom action, never updated: a changed action is a new row with a new name, so a workflow
 * version that names one never changes under its members.
 */
export const customActions = pgTable(
  "custom_actions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    // Unique in the org; workflow versions name it, as they name catalog actions.
    name: text("name").notNull(),
    // The registered app it calls.
    app: text("app").notNull(),
    // The checked description, without any level the builder proposed.
    description: zodJsonb("description", customActionDescriptionSchema).notNull(),
    // The level the fixed rule set when it was accepted.
    risk: text("risk", {
      enum: ["read", "internal_reversible", "external_send", "financial", "destructive"],
    })
      .$type<RiskLevel>()
      .notNull(),
    // The admin who accepted it, a plain user ID, like a workflow's creator.
    acceptedBy: text("accepted_by").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
    // The builder proposal it was accepted with; a plain ID, since the action outlives it.
    proposalId: text("proposal_id"),
  },
  (table) => [unique("custom_actions_org_id_name_unique").on(table.orgId, table.name)],
);

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
    inputs: zodJsonb("inputs", z.array(capabilityRequestFieldSchema)).notNull(),
    outputs: zodJsonb("outputs", z.array(capabilityRequestFieldSchema)).notNull(),
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
    index("capability_request_asks_org_id_request_id_idx").on(table.orgId, table.requestId),
    foreignKey({
      name: "capability_request_asks_request_fk",
      columns: [table.orgId, table.requestId],
      foreignColumns: [capabilityRequests.orgId, capabilityRequests.id],
    }).onDelete("cascade"),
    index("capability_request_asks_org_id_conversation_id_idx").on(
      table.orgId,
      table.conversationId,
    ),
    foreignKey({
      name: "capability_request_asks_conversation_fk",
      columns: [table.orgId, table.conversationId],
      foreignColumns: [builderConversations.orgId, builderConversations.id],
    }).onDelete("cascade"),
  ],
);
