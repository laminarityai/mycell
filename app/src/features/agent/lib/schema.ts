// A person's Ask Mycel conversations and their messages. Both are tenant-owned. A conversation
// references its owner as a member (org_id, user_id), so it stays in their org and goes when
// they're removed. Messages keep the person's words, the agent's replies and its tool calls
// with only the IDs of what they read, never fact text or fetched content (invariant 8). A
// message's keyword index, for searching conversations, is made of its text parts alone.
import "server-only";
import { sql } from "drizzle-orm";
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
import { tsvector, zodJsonb } from "@/db/columns";
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

/** The JSON path to a message's text parts' words, in its `parts`: what search reads. */
export const TEXT_PARTS = sql.raw(`'$[*] ? (@.type == "text").text'`);

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
    // Searching conversations' keyword index, derived by Postgres from the message's text
    // parts only (the person's words, Mycel's reply): never a tool call or a notice.
    keywords: tsvector("keywords")
      .notNull()
      .generatedAlwaysAs(
        sql`jsonb_to_tsvector('english', jsonb_path_query_array(parts, ${TEXT_PARTS}), '["string"]')`,
      ),
  },
  (table) => [
    index("agent_messages_org_id_conversation_id_idx").on(table.orgId, table.conversationId),
    index("agent_messages_keywords_idx").using("gin", table.keywords),
    foreignKey({
      name: "agent_messages_conversation_fk",
      columns: [table.orgId, table.conversationId],
      foreignColumns: [agentConversations.orgId, agentConversations.id],
    }).onDelete("cascade"),
  ],
);
