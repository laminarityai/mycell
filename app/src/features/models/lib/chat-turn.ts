// One metered chat turn, shared by every chat (the builder's, and Ask Mycel's): one `streamText`
// call on the chat's role with its tools, streamed to the chat page as UI message chunks. The
// turn runs to its end even if the page goes away, then stores the model's message and records
// the turn's cost in the ledger, however the turn ended (invariant 7). The chat keeps its own
// conversations, prompts and UI parts; the turn knows them only through the request.
import { randomUUID } from "node:crypto";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type ModelMessage,
  type StepResult,
  type TextStreamPart,
  type ToolSet,
} from "ai";
import type { ModelRole } from "@/features/spec/types";
import type { Ctx } from "@/lib/ctx";
import { OutOfCreditsError, typedErrorMessage } from "@/lib/errors";
import type { PromptText } from "@/lib/prompts";
import type { CallAttribution, ChatPart, ChatUIMessage, Notice } from "../types";
import { bindChatTools, storedOutput, type ChatTools } from "./chat-tools";
import { openMeteredStream } from "./metered-stream";
import { chatTurnPrompts } from "./prompts";

/** One turn of a chat, as the chat asks for it. `T` is what its tools know about the turn. */
export type ChatTurnRequest<T> = {
  role: ModelRole;
  attribution?: CallAttribution;
  tools: ChatTools<T>;
  /** Handed to each tool call, which may keep state on it for the rest of the turn. */
  turn: T;
  /** The turn's model steps, at most. */
  maxSteps: number;
  /** The notice a turn that fails partway ends with, for the people in the chat. */
  failedText: string;
  /**
   * What the model is given: run while the credit check runs, and awaited even out of credits,
   * so the chat may store the person's message here.
   */
  prepare(): Promise<{ instructions: PromptText; messages: ModelMessage[] }>;
  /** Stores the model's message, once: when the turn ends, or with the out-of-credits notice. */
  store(message: { id: string; parts: ChatPart[] }): Promise<void>;
};

/** What a failed tool call says, kept and shown, unless it's one of our typed errors. */
const TOOL_FAILED = chatTurnPrompts.toolFailed();

/**
 * Streams the model's reply to the chat page. Out of credits, no model is called: the
 * conversation gets a notice saying why, and so does the stream.
 */
export async function streamChatTurn<T>(ctx: Ctx, request: ChatTurnRequest<T>): Promise<Response> {
  const { tools } = request;
  // What the model is given and the credit check don't wait on each other.
  const [{ instructions, messages }, opened] = await Promise.all([
    request.prepare(),
    openMeteredStream(ctx, request.role, request.attribution).then(
      (stream) => ({ ok: true as const, stream }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);
  const messageId = randomUUID();
  if (!opened.ok) {
    const { error } = opened;
    if (!(error instanceof OutOfCreditsError)) throw error;
    const notice: Notice = { kind: "out_of_credits", text: error.message };
    await request.store({ id: messageId, parts: [{ type: "notice", ...notice }] });
    return noticeResponse(messageId, notice);
  }
  const metered = opened.stream;
  const failedNotice: Notice = { kind: "failed", text: request.failedText };

  const parts: ChatPart[] = [];
  let failed = false;
  const result = streamText({
    model: metered.model,
    instructions,
    messages,
    tools: bindChatTools(tools, ctx, request.turn),
    stopWhen: isStepCount(request.maxSteps),
    // A retry would be a second call the pre-flight didn't cover.
    maxRetries: 0,
    onStepEnd: (step) => {
      metered.meterStep(step.providerMetadata);
      parts.push(...storedParts(tools, step));
    },
    // A failed step ends the turn; the error itself may quote the model, so it isn't kept.
    onError: () => {
      failed = true;
    },
  });

  const stream = createUIMessageStream<ChatUIMessage>({
    execute: async ({ writer }) => {
      writer.merge(
        toUIMessageStream<ToolSet, ChatUIMessage>({
          stream: result.stream.pipeThrough(asStored(tools)),
          generateMessageId: () => messageId,
          onError: (error) => (error instanceof ShownToolError ? error.message : failedNotice.text),
        }),
      );
      await result.consumeStream({
        onError: () => {
          failed = true;
        },
      });
      if (failed) parts.push({ type: "notice", ...failedNotice });
      await request.store({ id: messageId, parts });
      await metered.finish(failed ? "failed" : "succeeded");
    },
    onError: () => failedNotice.text,
  });
  return createUIMessageStreamResponse({ stream });
}

// A tool error already made safe to show, carried through the UI stream's `onError`.
class ShownToolError extends Error {}

/**
 * The model's stream as the page may see it: each tool result as that tool stores it, and each
 * tool error as the conversation keeps it. The model got the full result and error within the
 * turn, server-side; the page gets no more than reopening the conversation shows (invariant 8).
 */
function asStored<T>(
  tools: ChatTools<T>,
): TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>> {
  return new TransformStream({
    transform(part, controller) {
      if (part.type === "tool-result") {
        controller.enqueue({ ...part, output: storedOutput(tools, part.toolName, part.output) });
      } else if (part.type === "tool-error") {
        controller.enqueue({ ...part, error: new ShownToolError(toolErrorText(part.error)) });
      } else {
        controller.enqueue(part);
      }
    },
  });
}

// A typed error's message is ours; any other (the SDK's input validation, say) may quote the
// model's input, so it's kept and shown only as a generic line, as `onError` drops a failed
// step's error.
function toolErrorText(error: unknown): string {
  return typedErrorMessage(error) ?? TOOL_FAILED;
}

// What the conversation keeps of one model step: its text, and each tool call with its result
// as that tool stores it.
function storedParts<T>(tools: ChatTools<T>, step: StepResult<ToolSet>): ChatPart[] {
  return step.content.flatMap((part): ChatPart[] => {
    if (part.type === "text") return part.text === "" ? [] : [{ type: "text", text: part.text }];
    if (part.type === "tool-result") {
      const output = storedOutput(tools, part.toolName, part.output);
      return [{ ...toolCall(part), output, isError: false }];
    }
    if (part.type === "tool-error") {
      return [{ ...toolCall(part), output: toolErrorText(part.error), isError: true }];
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
  const stream = createUIMessageStream<ChatUIMessage>({
    execute: ({ writer }) => {
      writer.write({ type: "start", messageId });
      writer.write({ type: "data-notice", data: notice });
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
