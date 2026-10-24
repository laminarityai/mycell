// A person's Ask Mycel conversations and their messages. Both are tenant-owned. A conversation
// references its owner as a member (org_id, user_id), so it stays in their org and goes when
// they're removed. Messages keep the person's words, the agent's replies and its tool calls
// with only the IDs of what they read, never fact text or fetched content (invariant 8). A
// pending run is a run the agent offered, waiting for the person to press Run.
import "server-only";
import {
  bigserial,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { member } from "@/db/auth-schema";
import { zodJsonb } from "@/db/columns";
// A pending run goes with the inbox its message is in, and with its workflow.
import { connections } from "@/features/connections/lib/schema";
import { workflows } from "@/features/workflows/lib/schema";
import { storedPartSchema } from "../types";

export const agentConversations = pgTable(
  "agent_conversations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    // The person whose conversation it is: the only one who may read or continue it.
    ownerUserId: text("owner_user_id").notNull(),
    // The first words of its first message, for the rail. Null until then.
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("agent_conversations_org_id_id_unique").on(table.orgId, table.id),
    // The rail: one person's conversations, most recently active first.
    index("agent_conversations_org_id_owner_user_id_updated_at_idx").on(
      table.orgId,
      table.ownerUserId,
      table.updatedAt,
    ),
    // Removing a member deletes their member row, and with it their conversations.
    foreignKey({
      name: "agent_conversations_member_fk",
      columns: [table.orgId, table.ownerUserId],
      foreignColumns: [member.organizationId, member.userId],
    }).onDelete("cascade"),
  ],
);

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    // Orders a conversation's messages.
    seq: bigserial("seq", { mode: "number" }).notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    parts: zodJsonb("parts", z.array(storedPartSchema)).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_messages_org_id_conversation_id_idx").on(table.orgId, table.conversationId),
    foreignKey({
      name: "agent_messages_conversation_fk",
      columns: [table.orgId, table.conversationId],
      foreignColumns: [agentConversations.orgId, agentConversations.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A pending run: a run of one of the person's own switched-on workflows on a message in their
 * own mail, which `propose_run` offered in a conversation and which waits for them to press Run.
 * It keeps the message's source ref only, never its sender or subject (invariant 8): the page
 * fetches those from Gmail. `run_id` is the run Run started; null while it waits. It goes with
 * its conversation, its workflow and the inbox the message is in (invariant 3).
 */
export const agentPendingRuns = pgTable(
  "agent_pending_runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    // The person's own member connection, which the message is in and the run runs on.
    connectionId: text("connection_id").notNull(),
    ownerScope: text("owner_scope", { enum: ["member"] })
      .notNull()
      .default("member"),
    // The message's Gmail ID.
    sourceRef: text("source_ref").notNull(),
    // No foreign key: a run goes only with its connection or workflow, which take this row too.
    runId: text("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_pending_runs_org_id_conversation_id_idx").on(table.orgId, table.conversationId),
    foreignKey({
      name: "agent_pending_runs_conversation_fk",
      columns: [table.orgId, table.conversationId],
      foreignColumns: [agentConversations.orgId, agentConversations.id],
    }).onDelete("cascade"),
    index("agent_pending_runs_org_id_workflow_id_idx").on(table.orgId, table.workflowId),
    foreignKey({
      name: "agent_pending_runs_workflow_fk",
      columns: [table.orgId, table.workflowId],
      foreignColumns: [workflows.orgId, workflows.id],
    }).onDelete("cascade"),
    index("agent_pending_runs_org_id_connection_id_idx").on(table.orgId, table.connectionId),
    foreignKey({
      name: "agent_pending_runs_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
  ],
);
