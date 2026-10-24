// One Ask Mycel turn: the person's message, then `models`' metered chat turn on the `smart` role
// with the agent's instructions and tools, streamed to the chat page and charged to `agent`.
// The conversation keeps the person's message as the turn starts, and Mycel's message, or the
// out-of-credits notice, when it ends.
import { chatModelMessages, streamChatTurn } from "@/features/models/server";
import type { Ctx } from "@/lib/ctx";
import { ValidationError } from "@/lib/errors";
import { appendMessage, findConversation, messagesOf } from "./conversations";
import { instructionPrompts } from "./prompts";
import { storeReply } from "./reply-sources";
import { agentTools, type AgentTurn } from "./tools";

/** A turn's model steps, at most. */
export const MAX_STEPS = 6;

/** The longest message a person may send. */
const MAX_MESSAGE = 4000;

const FAILED_TEXT = "Mycel stopped before it finished. Try sending your message again.";

export async function streamTurn(
  ctx: Ctx,
  conversationId: string,
  message: string,
): Promise<Response> {
  const text = message.trim();
  // NotFoundError unless it's the ctx's user's own conversation; ForbiddenError for no one.
  const conversation = await findConversation(ctx, conversationId);
  if (text === "") throw new ValidationError("Write a message first.");
  if (text.length > MAX_MESSAGE) {
    throw new ValidationError(`Keep a message under ${String(MAX_MESSAGE)} characters.`);
  }
  // Read before the person's message is stored, so it holds only earlier ones.
  const history = await messagesOf(ctx, conversation.id);
  const turn: AgentTurn = { conversationId: conversation.id };
  return streamChatTurn(ctx, {
    role: "smart",
    attribution: { purpose: "agent" },
    tools: agentTools,
    turn,
    maxSteps: MAX_STEPS,
    failedText: FAILED_TEXT,
    async prepare() {
      await appendMessage(ctx, conversation, { role: "user", parts: [{ type: "text", text }] });
      return {
        instructions: instructionPrompts.instructions({
          today: new Date().toISOString().slice(0, 10),
        }),
        // A removed reply reaches the model as nothing at all: its words went with its data.
        messages: [...chatModelMessages(history, () => undefined), { role: "user", content: text }],
      };
    },
    // With what it drew on, so it goes when that does (invariant 3).
    store: (reply) => storeReply(ctx, conversation, history, reply),
  });
}
