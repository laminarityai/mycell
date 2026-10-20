// One builder turn: the admin's message, then one `streamText` call on the `smart` role with
// the org's context and the agent's tools, streamed to the chat page as UI message chunks.
// The turn runs to its end even if the page goes away, then stores the agent's message and
// records the turn's cost in the ledger, however the turn ended (invariant 7).
import { randomUUID } from "node:crypto";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type StepResult,
  type ToolSet,
} from "ai";
import { openMeteredStream } from "@/features/runtime/server";
import type { MeteredStream } from "@/features/runtime/types";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { OutOfCreditsError, ValidationError } from "@/lib/errors";
import type { BuilderUIMessage, Notice, StoredPart } from "../types";
import { gatherContext } from "./context";
import { appendMessage, findConversation, messagesOf } from "./conversations";
import { toModelMessages } from "./history";
import { instructionsWith } from "./instructions";
import { builderTools, type BuilderTool, type TurnInfo } from "./tools";

/** A turn's model steps, at most (spec #43, "Limits"). */
export const MAX_STEPS = 8;

const FAILED: Notice = {
  kind: "failed",
  text: "The builder stopped before it finished. Try sending your message again.",
};

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
  const history = await messagesOf(ctx, conversation.id);
  await appendMessage(ctx, conversation, { role: "user", parts: [{ type: "text", text }] });

  const turn: TurnInfo = { conversationId: conversation.id, workflowId: conversation.workflowId };
  const instructions = instructionsWith(await gatherContext(ctx, turn));
  const assistantId = randomUUID();
  let metered: MeteredStream;
  try {
    metered = await openMeteredStream(ctx, "smart");
  } catch (error) {
    if (!(error instanceof OutOfCreditsError)) throw error;
    const notice: Notice = { kind: "out_of_credits", text: error.message };
    await appendMessage(ctx, conversation, {
      id: assistantId,
      role: "assistant",
      parts: [{ type: "notice", ...notice }],
    });
    return noticeResponse(assistantId, notice);
  }

  const tools = Object.fromEntries(
    Object.entries(builderTools).map(([name, builderTool]) => [name, builderTool.bind(ctx, turn)]),
  );
  const parts: StoredPart[] = [];
  let failed = false;
  const result = streamText({
    model: metered.model,
    instructions,
    messages: [...toModelMessages(history), { role: "user", content: text }],
    tools,
    stopWhen: isStepCount(MAX_STEPS),
    // A retry would be a second call the pre-flight didn't cover.
    maxRetries: 0,
    onStepEnd: (step) => {
      metered.meterStep(step.providerMetadata);
      parts.push(...storedParts(step));
    },
    // A failed step ends the turn; the error itself may quote the model, so it isn't kept.
    onError: () => {
      failed = true;
    },
  });

  const stream = createUIMessageStream<BuilderUIMessage>({
    execute: async ({ writer }) => {
      writer.merge(
        toUIMessageStream<ToolSet, BuilderUIMessage>({
          stream: result.stream,
          generateMessageId: () => assistantId,
          onError: () => FAILED.text,
        }),
      );
      await result.consumeStream({
        onError: () => {
          failed = true;
        },
      });
      if (failed) parts.push({ type: "notice", ...FAILED });
      await appendMessage(ctx, conversation, { id: assistantId, role: "assistant", parts });
      await metered.finish(failed ? "failed" : "succeeded");
    },
    onError: () => FAILED.text,
  });
  return createUIMessageStreamResponse({ stream });
}

// What the conversation keeps of one model step: its text, and each tool call with its result
// as that tool stores it.
function storedParts(step: StepResult<ToolSet>): StoredPart[] {
  return step.content.flatMap((part): StoredPart[] => {
    if (part.type === "text") return part.text === "" ? [] : [{ type: "text", text: part.text }];
    if (part.type === "tool-result") {
      const result: unknown = part.output;
      const builderTool = builderTools[part.toolName] as BuilderTool | undefined;
      const output = builderTool === undefined ? result : builderTool.stored(result);
      return [{ ...toolCall(part), output, isError: false }];
    }
    if (part.type === "tool-error") {
      const output = part.error instanceof Error ? part.error.message : String(part.error);
      return [{ ...toolCall(part), output, isError: true }];
    }
    return [];
  });
}

function toolCall(part: { toolCallId: string; toolName: string; input: unknown }) {
  return {
    type: "tool" as const,
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    input: part.input,
  };
}

function noticeResponse(messageId: string, notice: Notice): Response {
  const stream = createUIMessageStream<BuilderUIMessage>({
    execute: ({ writer }) => {
      writer.write({ type: "start", messageId });
      writer.write({ type: "data-notice", data: notice });
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
