// A person's Ask Mycel conversations and their messages. Both are tenant-owned. A conversation
// references its owner as a member (org_id, user_id), so it stays in their org and goes when
// they're removed. Messages keep the person's words, the agent's replies and its tool calls
// with only the IDs of what they read, never fact text or fetched content (invariant 8).
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
