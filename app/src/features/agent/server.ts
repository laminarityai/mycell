// The agent feature (M9): each person's own private chat with Mycel, "Ask Mycel". Every function
// needs the ctx's user to own the conversation, with no admin or system exception: anyone else
// gets NotFoundError, and the system ctx ForbiddenError. Nothing imports this feature.
import "server-only";
import type { Ctx } from "@/lib/ctx";
import type { AgentConversation, RailList } from "./types";
import { citationsOf } from "./lib/citations";
import { findConversation, listConversations, messagesOf, summary } from "./lib/conversations";
import { searchConversations } from "./lib/search";

export { deleteConversation, listConversations, startConversation } from "./lib/conversations";
export { searchConversations } from "./lib/search";
// Called by the streaming route: Mycel's reply as a UI message stream.
export { streamTurn } from "./lib/turn";

/** One of the person's conversations, with its messages and the citations its replies show. */
export async function getConversation(
  ctx: Ctx,
  conversationId: string,
): Promise<AgentConversation> {
  const row = await findConversation(ctx, conversationId);
  const messages = await messagesOf(ctx, row.id);
  return {
    ...summary(row),
    createdAt: row.createdAt,
    messages,
    citations: await citationsOf(ctx, messages),
  };
}

/** What the rail lists: the person's conversations, or, given a search, what it found. */
export async function listRail(ctx: Ctx, query: string | undefined): Promise<RailList> {
  return query === undefined
    ? { query: null, conversations: await listConversations(ctx) }
    : { query, hits: await searchConversations(ctx, query) };
}
