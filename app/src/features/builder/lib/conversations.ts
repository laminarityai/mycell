// Builder conversations: admin-only. Any admin of the org may open and continue any of its
// conversations, whoever started it.
import { randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { getWorkflow } from "@/features/workflows/server";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import {
  storedPartSchema,
  type BuilderConversation,
  type BuilderMessage,
  type ConversationSummary,
  type StoredPart,
} from "../types";
import { builderConversations, builderMessages } from "./schema";

type ConversationRow = typeof builderConversations.$inferSelect;

/** A conversation's title: the start of its first message. */
const TITLE_LENGTH = 80;

/** Starts a conversation, about one of the org's workflows when `workflowId` is set. */
export async function startConversation(
  ctx: Ctx,
  input: { workflowId?: string },
): Promise<ConversationSummary> {
  requireAdmin(ctx);
  // NotFoundError for another org's workflow.
  if (input.workflowId !== undefined) await getWorkflow(ctx, input.workflowId);
  const inserted = await forOrg(ctx).insert(builderConversations, {
    id: randomUUID(),
    startedBy: ctx.userId,
    workflowId: input.workflowId ?? null,
  });
  const row = inserted.at(0);
  // An insert returns its row, so this is a bug, not something a user can act on.
  if (row === undefined) throw new Error("The conversation wasn't recorded.");
  return summary(row);
}

/** The org's conversations, most recently active first. */
export async function listConversations(ctx: Ctx): Promise<ConversationSummary[]> {
  requireAdmin(ctx);
  const rows = await forOrg(ctx).select(builderConversations, {
    orderBy: [desc(builderConversations.updatedAt), desc(builderConversations.id)],
  });
  return rows.map(summary);
}

/** One conversation with its messages, oldest first. */
export async function getConversation(
  ctx: Ctx,
  conversationId: string,
): Promise<BuilderConversation> {
  requireAdmin(ctx);
  const row = await findConversation(ctx, conversationId);
  return { ...summary(row), createdAt: row.createdAt, messages: await messagesOf(ctx, row.id) };
}

/** The conversation's row; NotFoundError when it isn't the org's. */
export async function findConversation(ctx: Ctx, conversationId: string): Promise<ConversationRow> {
  const rows = await forOrg(ctx).select(builderConversations, {
    where: eq(builderConversations.id, conversationId),
    limit: 1,
  });
  const row = rows.at(0);
  if (row === undefined) throw new NotFoundError("conversation");
  return row;
}

export async function messagesOf(ctx: Ctx, conversationId: string): Promise<BuilderMessage[]> {
  const rows = await forOrg(ctx).select(builderMessages, {
    where: eq(builderMessages.conversationId, conversationId),
    orderBy: [asc(builderMessages.seq)],
  });
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    authorId: row.authorId,
    // Parsed on the way out: the rows feed the model and the page.
    parts: storedPartSchema.array().parse(row.parts),
    createdAt: row.createdAt,
  }));
}

/** Appends a message, and titles the conversation by its first one. */
export async function appendMessage(
  ctx: Ctx,
  conversation: ConversationRow,
  message: { id?: string; role: "user" | "assistant"; parts: StoredPart[] },
): Promise<void> {
  const db = forOrg(ctx);
  await db.insert(builderMessages, {
    id: message.id ?? randomUUID(),
    conversationId: conversation.id,
    role: message.role,
    authorId: message.role === "user" ? ctx.userId : null,
    parts: message.parts,
  });
  const text = message.parts.find((part) => part.type === "text")?.text;
  const title =
    conversation.title === null && message.role === "user" && text !== undefined
      ? { title: text.slice(0, TITLE_LENGTH) }
      : {};
  await db.update(
    builderConversations,
    { ...title, updatedAt: new Date() },
    eq(builderConversations.id, conversation.id),
  );
}

function summary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    startedBy: row.startedBy,
    workflowId: row.workflowId,
    updatedAt: row.updatedAt,
  };
}
