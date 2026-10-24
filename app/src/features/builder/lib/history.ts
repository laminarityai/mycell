// Stored messages, read back two ways (`models`' chat history): as the model's context for the
// next turn, and as the chat page's UI messages. Notices are for the admins only and never reach
// the model; an admin's try-it summary reaches it as their words.
import type { ModelMessage } from "ai";
import { chatModelMessages, chatUIPart } from "@/features/models/server";
import type { BuilderMessage, BuilderUIMessage } from "../types";
import { tryItText } from "./try-it-summary";

/** The last turns whose tool results the model is sent (#132); older ones say they were dropped. */
export const TOOL_RESULT_TURNS = 3;

/**
 * The conversation so far, as the model sees it: the admins' words and try-it summaries, and
 * each agent step's text and tool calls, with the results of the last 3 turns' calls.
 */
export function toModelMessages(messages: BuilderMessage[]): ModelMessage[] {
  return chatModelMessages(messages, tryItText, { toolResultTurns: TOOL_RESULT_TURNS });
}

/** The conversation as the chat page shows it. */
export function toUIMessages(messages: BuilderMessage[]): BuilderUIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts.map((part) =>
      part.type === "try_it"
        ? { type: "data-tryIt", data: { lines: part.lines, costUsd: part.costUsd } }
        : chatUIPart(part),
    ),
  }));
}
