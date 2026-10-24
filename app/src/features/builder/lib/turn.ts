// One builder turn: the admin's message, then `models`' metered chat turn on the `smart` role
// with the org's context and the agent's tools, streamed to the chat page. The conversation
// keeps the admin's message as the turn starts, and the agent's message, or the out-of-credits
// notice, when it ends.
import { listCustomActions } from "@/features/custom-actions/server";
import { streamChatTurn } from "@/features/models/server";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ValidationError } from "@/lib/errors";
import { gatherContext } from "./context";
import { appendMessage, findConversation, messagesOf } from "./conversations";
import { instructionsWith } from "./instructions";
import { modelHistory, summarySection } from "./model-history";
import { builderTools, type TurnInfo } from "./tools";

/** A turn's model steps, at most (spec #43, "Limits"). */
export const MAX_STEPS = 8;

const FAILED_TEXT = "The builder stopped before it finished. Try sending your message again.";

/**
 * Takes the admin's message and streams the agent's reply. Out of credits, no model is called:
 * the conversation gets a notice saying why, and so does the stream.
 */
export async function streamTurn(
  ctx: Ctx,
  conversationId: string,
  message: string,
): Promise<Response> {
  requireAdmin(ctx);
  const text = message.trim();
  if (text === "") throw new ValidationError("Write a message first.");
  const conversation = await findConversation(ctx, conversationId);
  // The history is read before the admin's message is stored, so it holds only earlier ones.
  const [history, storedCustomActions] = await Promise.all([
    messagesOf(ctx, conversation.id),
    listCustomActions(ctx),
  ]);

  const turn: TurnInfo = {
    conversationId: conversation.id,
    workflowId: conversation.workflowId,
    message: text,
    failedProposals: 0,
    storedCustomActions,
    customActions: [],
  };
  return streamChatTurn(ctx, {
    role: "smart",
    attribution: { purpose: "builder" },
    tools: builderTools,
    turn,
    maxSteps: MAX_STEPS,
    failedText: FAILED_TEXT,
    // Runs alongside the credit check; the context and the history, summarized first if it's
    // grown too long, don't wait on storing the message either.
    async prepare() {
      const [, context, sent] = await Promise.all([
        appendMessage(ctx, conversation, { role: "user", parts: [{ type: "text", text }] }),
        gatherContext(ctx, turn),
        modelHistory(ctx, conversation, history),
      ]);
      return {
        instructions: instructionsWith([...context, ...summarySection(sent.summary)]),
        messages: [...sent.messages, { role: "user", content: text }],
      };
    },
    store: ({ id, parts }) => appendMessage(ctx, conversation, { id, role: "assistant", parts }),
  });
}
