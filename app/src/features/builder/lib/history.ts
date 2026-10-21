// Stored messages, read back two ways: as the model's context for the next turn, and as the
// chat page's UI messages. Notices are for the admins only and never reach the model; an
// admin's try-it summary reaches it as their words.
import type { AssistantModelMessage, JSONValue, ModelMessage, ToolModelMessage } from "ai";
import type { BuilderMessage, BuilderUIMessage, StoredPart } from "../types";
import { tryItText } from "./try-it-summary";

/**
 * The conversation so far, as the model sees it: the admins' words and try-it summaries, and
 * each agent step's text and tool calls.
 */
export function toModelMessages(messages: BuilderMessage[]): ModelMessage[] {
  return messages.flatMap((message) => {
    if (message.role === "user") {
      const text = message.parts
        .flatMap((part) =>
          part.type === "text" ? [part.text] : part.type === "try_it" ? [tryItText(part)] : [],
        )
        .join("\n");
      return text === "" ? [] : [{ role: "user", content: text }];
    }
    return agentMessages(message.parts);
  });
}

// The agent's message is a run of steps: text and tool calls, each step's results answered by
// a tool message before the next step's text.
function agentMessages(parts: StoredPart[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  let assistant: AssistantModelMessage | undefined;
  let results: ToolModelMessage | undefined;
  const flush = () => {
    if (assistant !== undefined) out.push(assistant);
    if (results !== undefined) out.push(results);
    assistant = undefined;
    results = undefined;
  };
  for (const part of parts) {
    if (part.type === "notice" || part.type === "try_it") continue;
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

/** The conversation as the chat page shows it. */
export function toUIMessages(messages: BuilderMessage[]): BuilderUIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts.map(toUIPart),
  }));
}

function toUIPart(part: StoredPart): BuilderUIMessage["parts"][number] {
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "notice") {
    return { type: "data-notice", data: { kind: part.kind, text: part.text } };
  }
  if (part.type === "try_it") {
    return { type: "data-tryIt", data: { lines: part.lines, costUsd: part.costUsd } };
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
