// The agent feature (M9): each person's own private chat with Mycel, "Ask Mycel". Every function
// needs the ctx's user to own the conversation, with no admin or system exception: anyone else
// gets NotFoundError, and the system ctx ForbiddenError. Nothing imports this feature.
import "server-only";
import type { Ctx } from "@/lib/ctx";
import type { AgentConversation } from "./types";
import { citationsOf } from "./lib/citations";
import { findConversation, messagesOf, summary } from "./lib/conversations";
import { foundIn } from "./lib/found";

export { deleteConversation, listConversations, startConversation } from "./lib/conversations";
// Called by the streaming route: Mycel's reply as a UI message stream.
export { streamTurn } from "./lib/turn";

/**
 * One of the person's conversations, with its messages, the citations its replies show, and
 * the messages, reviews and workflows its tools found, read again.
 */
export async function getConversation(
  ctx: Ctx,
  conversationId: string,
): Promise<AgentConversation> {
  const row = await findConversation(ctx, conversationId);
  const messages = await messagesOf(ctx, row.id);
  const [citations, found] = await Promise.all([
    citationsOf(ctx, messages),
    foundIn(ctx, messages),
  ]);
  return { ...summary(row), createdAt: row.createdAt, messages, citations, found };
}
