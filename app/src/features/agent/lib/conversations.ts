// A person's Ask Mycel conversations: theirs alone. Every read and write needs the ctx's user to
// own the conversation, with no admin or system exception (spec #154): anyone else gets
// NotFoundError, which tells them nothing, and the system ctx, which is no one, ForbiddenError.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, lt } from "drizzle-orm";
import { forOrg, type OrgScopedDb } from "@/db/for-org";
import { requireRole, requireSystem, type Ctx } from "@/lib/ctx";
import { InvariantError, NotFoundError } from "@/lib/errors";
import { DAY_MS, now as clockNow } from "@/lib/time";
import {
  IDLE_CONVERSATION_DAYS,
  type AgentConversationSummary,
  type AgentMessage,
  type StoredPart,
} from "../types";
import { agentConversations, agentMessages } from "./schema";

export type ConversationRow = typeof agentConversations.$inferSelect;

/** A conversation's title: the start of its first message. */
const TITLE_LENGTH = 80;

/** A person: an admin or a member, never the system ctx. */
export function requirePerson(ctx: Ctx): void {
  requireRole(ctx, "admin", "member");
}

/**
 * Starts a conversation for the ctx's user, or hands back their newest one while it's still
 * empty, so pressing New conversation twice doesn't leave empty ones behind.
 */
export async function startConversation(ctx: Ctx): Promise<AgentConversationSummary> {
  requirePerson(ctx);
  const db = forOrg(ctx);
  const empty = await db.select(agentConversations, {
    columns: ["id", "title", "updatedAt"],
    where: and(eq(agentConversations.ownerUserId, ctx.userId), isNull(agentConversations.title)),
    orderBy: [desc(agentConversations.updatedAt)],
    limit: 1,
  });
  const reused = empty.at(0);
  if (reused !== undefined) return reused;
  const inserted = await db.insert(agentConversations, {
    id: randomUUID(),
    ownerUserId: ctx.userId,
  });
  const row = inserted.at(0);
  // An insert returns its row, so this is a bug, not something a user can act on.
  if (row === undefined) throw new InvariantError("The conversation wasn't recorded.");
  return summary(row);
}

/** The ctx's user's conversations, most recently active first. */
export async function listConversations(ctx: Ctx): Promise<AgentConversationSummary[]> {
  requirePerson(ctx);
  return forOrg(ctx).select(agentConversations, {
    columns: ["id", "title", "updatedAt"],
    where: eq(agentConversations.ownerUserId, ctx.userId),
    orderBy: [desc(agentConversations.updatedAt), desc(agentConversations.id)],
  });
}

/** Deletes one of the ctx's user's conversations, with its messages. */
export async function deleteConversation(ctx: Ctx, conversationId: string): Promise<void> {
  const conversation = await findConversation(ctx, conversationId);
  await forOrg(ctx).deleteCount(agentConversations, eq(agentConversations.id, conversation.id));
}

/** The conversation's row; NotFoundError unless it's the ctx's user's own. */
export async function findConversation(ctx: Ctx, conversationId: string): Promise<ConversationRow> {
  requirePerson(ctx);
  const rows = await forOrg(ctx).select(agentConversations, {
    where: and(
      eq(agentConversations.id, conversationId),
      eq(agentConversations.ownerUserId, ctx.userId),
    ),
    limit: 1,
  });
  const row = rows.at(0);
  if (row === undefined) throw new NotFoundError("conversation");
  return row;
}

/** A conversation's messages, oldest first. The caller checked it's the ctx's user's. */
export async function messagesOf(ctx: Ctx, conversationId: string): Promise<AgentMessage[]> {
  const rows = await forOrg(ctx).select(agentMessages, {
    columns: ["id", "role", "parts", "createdAt"],
    where: eq(agentMessages.conversationId, conversationId),
    orderBy: [asc(agentMessages.seq)],
  });
  // Its column parsed each message's parts as it was read.
  return rows;
}

/**
 * Deletes the org's conversations nobody has used for IDLE_CONVERSATION_DAYS before `now`, with
 * their messages. The nightly job's, as the org's system ctx: the one write to conversations
 * that isn't their owner's. Returns how many went.
 */
export async function deleteIdleConversations(
  ctx: Ctx,
  now: Date = clockNow(),
): Promise<{ conversations: number }> {
  requireSystem(ctx);
  const cutoff = new Date(now.getTime() - IDLE_CONVERSATION_DAYS * DAY_MS);
  const conversations = await forOrg(ctx).deleteCount(
    agentConversations,
    lt(agentConversations.updatedAt, cutoff),
  );
  return { conversations };
}

/** Appends a message, and titles the conversation by its first one, in `db` when given. */
export async function appendMessage(
  ctx: Ctx,
  conversation: ConversationRow,
  message: { id?: string; role: "user" | "assistant"; parts: StoredPart[] },
  db: OrgScopedDb = forOrg(ctx),
): Promise<void> {
  await db.insert(agentMessages, {
    id: message.id ?? randomUUID(),
    conversationId: conversation.id,
    role: message.role,
    parts: message.parts,
  });
  const text = message.parts.find((part) => part.type === "text")?.text;
  const title =
    conversation.title === null && message.role === "user" && text !== undefined
      ? { title: text.slice(0, TITLE_LENGTH) }
      : {};
  await db.update(
    agentConversations,
    { ...title, updatedAt: clockNow() },
    eq(agentConversations.id, conversation.id),
  );
}

export function summary(row: ConversationRow): AgentConversationSummary {
  return { id: row.id, title: row.title, updatedAt: row.updatedAt };
}
