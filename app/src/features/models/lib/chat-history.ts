// A chat's stored messages, read back two ways: as the model's context for the next turn, and
// as the chat page's UI messages. Each chat stores the shared parts (`ChatPart`) and kinds of its
// own (the builder's try-it summaries), and says what each of its own reads as. Notices are for
// the people in the chat only and never reach the model.
import type { AssistantModelMessage, JSONValue, ModelMessage, ToolModelMessage } from "ai";
import type { ChatMessage, ChatPart, ChatUIPart } from "../types";

const CHAT_PART_TYPES: ReadonlySet<string> = new Set<ChatPart["type"]>(["text", "tool", "notice"]);

function isChatPart(part: { type: string }): part is ChatPart {
  return CHAT_PART_TYPES.has(part.type);
}

/**
 * The conversation so far, as the model sees it: each person's words, and each model step's
 * text and tool calls. A chat's own part reads as its message's words, as `ownText` writes them,
 * or not at all when that gives nothing.
 */
export function chatModelMessages<P extends { type: string }>(
  messages: ChatMessage<ChatPart | P>[],
  ownText: (part: P) => string | undefined,
): ModelMessage[] {
  return messages.flatMap((message) => {
    if (message.role === "user") {
      const text = message.parts
        .flatMap((part) => {
          if (isChatPart(part)) return part.type === "text" ? [part.text] : [];
          const text = ownText(part);
          return text === undefined ? [] : [text];
        })
        .join("\n");
      return text === "" ? [] : [{ role: "user" as const, content: text }];
    }
    return modelSteps(message.parts, ownText);
  });
}

// The model's message is a run of steps: text and tool calls, each step's results answered by
// a tool message before the next step's text.
function modelSteps<P extends { type: string }>(
  stored: (ChatPart | P)[],
  ownText: (part: P) => string | undefined,
): ModelMessage[] {
  const out: ModelMessage[] = [];
  let assistant: AssistantModelMessage | undefined;
  let results: ToolModelMessage | undefined;
  const flush = () => {
    if (assistant !== undefined) out.push(assistant);
    if (results !== undefined) out.push(results);
    assistant = undefined;
    results = undefined;
  };
  for (const storedPart of stored) {
    const part = asSharedPart(storedPart, ownText);
    if (part === undefined || part.type === "notice") continue;
    // Text after a step's tool results starts the next step.
    if (part.type === "text" && results !== undefined) flush();
    assistant ??= { role: "assistant", content: [] };
    const content = assistant.content as Exclude<AssistantModelMessage["content"], string>;
    if (part.type === "text") {
      content.push({ type: "text", text: part.text });
      continue;
    }
    content.push({
      type: "tool-call",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input: part.input,
    });
    results ??= { role: "tool", content: [] };
    results.content.push({
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: part.isError
        ? { type: "error-text", value: String(part.output) }
        : { type: "json", value: (part.output ?? null) as JSONValue },
    });
  }
  flush();
  return out;
}

// A chat's own part, in a model's message, reads as that message's text.
function asSharedPart<P extends { type: string }>(
  part: ChatPart | P,
  ownText: (part: P) => string | undefined,
): ChatPart | undefined {
  if (isChatPart(part)) return part;
  const text = ownText(part);
  return text === undefined || text === "" ? undefined : { type: "text", text };
}

/** A shared part as the chat page shows it; a chat maps its own kinds itself. */
export function chatUIPart(part: ChatPart): ChatUIPart {
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "notice") {
    return { type: "data-notice", data: { kind: part.kind, text: part.text } };
  }
  return part.isError
    ? {
        type: "dynamic-tool",
        toolName: part.toolName,
        toolCallId: part.toolCallId,
        state: "output-error",
        input: part.input,
        errorText: String(part.output),
      }
    : {
        type: "dynamic-tool",
        toolName: part.toolName,
        toolCallId: part.toolCallId,
        state: "output-available",
        input: part.input,
        output: part.output,
      };
}
