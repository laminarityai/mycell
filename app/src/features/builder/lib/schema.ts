// Builder conversations and their messages. Both are tenant-owned and hold no connection_id:
// messages keep the admins' and the agent's words and tool calls, never source content
// (invariant 8), so disconnecting a connection leaves them alone.
import {
  bigserial,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { InsertedApproval, RiskLevel } from "@/features/policy/types";
import type { Spec } from "@/features/spec/types";
// A conversation about a workflow goes with it.
import { workflows } from "@/features/workflows/lib/schema";
import type { StoredPart } from "../types";

export const builderConversations = pgTable(
  "builder_conversations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    // A plain user ID, like a workflow's creator: the conversation outlives the admin.
    startedBy: text("started_by").notNull(),
    workflowId: text("workflow_id"),
    // The first words of its first message, for the conversation list. Null until then.
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("builder_conversations_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      name: "builder_conversations_workflow_fk",
      columns: [table.orgId, table.workflowId],
      foreignColumns: [workflows.orgId, workflows.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A proposal: a whole spec the agent proposed in a conversation, already validated, for an
 * admin to accept or reject. `baseRevision` and `baseSpec` are the workflow's working spec it
 * was made against (null for a new workflow); accepting saves over that revision only.
 */
export const builderProposals = pgTable(
  "builder_proposals",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    // Null for a new workflow until it's accepted, which creates the workflow.
    workflowId: text("workflow_id"),
    baseRevision: integer("base_revision"),
    baseSpec: jsonb("base_spec").$type<Spec>(),
    // The proposed working spec, as `validateSpec` parsed it.
    spec: jsonb("spec").$type<Spec>().notNull(),
    // The workflow's name: its own for an existing workflow, one made from the spec ID for a new.
    name: text("name").notNull(),
    summary: text("summary").notNull(),
    // What the policy engine made of the spec when it was proposed.
    maxRisk: text("max_risk", {
      enum: ["read", "internal_reversible", "external_send", "financial", "destructive"],
    })
      .$type<RiskLevel>()
      .notNull(),
    inserted: jsonb("inserted").$type<InsertedApproval[]>().notNull(),
    status: text("status", { enum: ["proposed", "accepted", "rejected", "stale"] })
      .notNull()
      .default("proposed"),
    // The admin who accepted or rejected it, and when; a plain user ID, like a conversation's.
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "builder_proposals_conversation_fk",
      columns: [table.orgId, table.conversationId],
      foreignColumns: [builderConversations.orgId, builderConversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "builder_proposals_workflow_fk",
      columns: [table.orgId, table.workflowId],
      foreignColumns: [workflows.orgId, workflows.id],
    }).onDelete("cascade"),
  ],
);

export const builderMessages = pgTable(
  "builder_messages",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    // Orders a conversation's messages.
    seq: bigserial("seq", { mode: "number" }).notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    // The admin who wrote a user message; null for the agent's.
    authorId: text("author_id"),
    parts: jsonb("parts").$type<StoredPart[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "builder_messages_conversation_fk",
      columns: [table.orgId, table.conversationId],
      foreignColumns: [builderConversations.orgId, builderConversations.id],
    }).onDelete("cascade"),
  ],
);
