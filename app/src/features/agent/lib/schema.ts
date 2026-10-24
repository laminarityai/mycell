// A person's Ask Mycel conversations and their messages. Both are tenant-owned. A conversation
// references its owner as a member (org_id, user_id), so it stays in their org and goes when
// they're removed. Messages keep the person's words, the agent's replies and its tool calls
// with only the IDs of what they read, never fact text or fetched content (invariant 8). Each
// reply records what it drew on, the connections and the facts, in rows that cascade with them,
// and a trigger replaces the reply with a tombstone when one goes (invariant 3).
import "server-only";
import {
  bigserial,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { member } from "@/db/auth-schema";
import { zodJsonb } from "@/db/columns";
import { connections } from "@/features/connections/lib/schema";
import { facts } from "@/features/memory/lib/schema";
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
    unique("agent_messages_org_id_id_unique").on(table.orgId, table.id),
    index("agent_messages_org_id_conversation_id_idx").on(table.orgId, table.conversationId),
    foreignKey({
      name: "agent_messages_conversation_fk",
      columns: [table.orgId, table.conversationId],
      foreignColumns: [agentConversations.orgId, agentConversations.id],
    }).onDelete("cascade"),
  ],
);

// What a reply drew on. When a connection or a fact goes, its rows go with it (the foreign keys
// cascade), whichever path deleted it: disconnecting, Nango's webhook, reconciliation, a member
// leaving, forgetting a person, retention, an item leaving its app. A trigger on each table (the
// `ask-mycel-removed-replies` migration) then replaces each reply that lost a row with a
// tombstone, keeping its row so the conversation still reads in order.

/** A connection a reply drew on: where the facts it read came from, as its person saw them. */
export const agentMessageConnections = pgTable(
  "agent_message_connections",
  {
    orgId: text("org_id").notNull(),
    messageId: text("message_id").notNull(),
    connectionId: text("connection_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.connectionId] }),
    index("agent_message_connections_connection_id_idx").on(table.connectionId),
    foreignKey({
      name: "agent_message_connections_message_fk",
      columns: [table.orgId, table.messageId],
      foreignColumns: [agentMessages.orgId, agentMessages.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "agent_message_connections_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
  ],
);

/** A memory fact a reply read. */
export const agentMessageFacts = pgTable(
  "agent_message_facts",
  {
    orgId: text("org_id").notNull(),
    messageId: text("message_id").notNull(),
    factId: text("fact_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.factId] }),
    index("agent_message_facts_fact_id_idx").on(table.factId),
    foreignKey({
      name: "agent_message_facts_message_fk",
      columns: [table.orgId, table.messageId],
      foreignColumns: [agentMessages.orgId, agentMessages.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "agent_message_facts_fact_fk",
      columns: [table.orgId, table.factId],
      foreignColumns: [facts.orgId, facts.id],
    }).onDelete("cascade"),
  ],
);
