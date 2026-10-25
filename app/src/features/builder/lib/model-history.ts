// What a turn sends the model of its conversation so far (#132). Only the last 3 turns' tool
// results go (`history.ts`). Once the history passes about half the `smart` role's context
// window, everything but the last 10 turns is summarized on the `fast` role, the summary stored
// on the conversation and sent in their place from then on, and summarized again, the old
// summary included, when the history passes that size again. The admins still see every
// message; only what the model is sent shrinks.
import type { ModelMessage } from "ai";
import { callModel, CONTEXT_WINDOWS } from "@/features/models/server";
import { ModelCallError } from "@/features/models/types";
import type { Ctx } from "@/lib/ctx";
import { OutOfCreditsError } from "@/lib/errors";
import type { BuilderMessage } from "../types";
import type { ContextSection } from "./context";
import { storeHistorySummary, type ConversationRow } from "./conversations";
import { toModelMessages } from "./history";
import { historyPrompts } from "./prompts";

/** The last turns a summary leaves out, which the model is sent in full. */
export const KEPT_TURNS = 10;

/** Tokens are estimated from characters: about 4 to a token for English text and JSON. */
const CHARS_PER_TOKEN = 4;

/** A history this many characters long is summarized: half the `smart` role's window. */
const SUMMARIZE_PAST = (CONTEXT_WINDOWS.smart / 2) * CHARS_PER_TOKEN;

/** The conversation as the model is sent it: its history summary, if any, then the messages since. */
export type ModelHistory = { summary: string | null; messages: ModelMessage[] };

/**
 * The model's view of `messages`, the conversation's messages before this turn, summarizing
 * first when they've grown too long. A summary that can't be made (out of credits, or a failed
 * call) leaves the history as it was, to be summarized on a later turn.
 */
export async function modelHistory(
  ctx: Ctx,
  conversation: ConversationRow,
  messages: BuilderMessage[],
): Promise<ModelHistory> {
  const cut = messages.findIndex((message) => message.id === conversation.historySummarizedThrough);
  const since = messages.slice(cut + 1);
  const current = {
    summary: cut === -1 ? null : conversation.historySummary,
    messages: toModelMessages(since),
  };
  const turns = turnsOf(since);
  if (sizeOf(current) <= SUMMARIZE_PAST || turns.length <= KEPT_TURNS) return current;

  const older = turns.slice(0, -KEPT_TURNS).flat();
  const through = older.at(-1)?.id;
  const summary = await summarize(ctx, current.summary, toModelMessages(older));
  if (summary === undefined || through === undefined) return current;
  await storeHistorySummary(ctx, conversation.id, { summary, through });
  return { summary, messages: toModelMessages(turns.slice(-KEPT_TURNS).flat()) };
}

/** The section of the agent's instructions holding the summary, when there is one. */
export function summarySection(summary: string | null): ContextSection[] {
  if (summary === null) return [];
  return [{ title: historyPrompts.earlierTitle(), content: historyPrompts.earlier({ summary }) }];
}

// The messages in turns: each starts with an admin's message and holds the replies to it.
function turnsOf(messages: BuilderMessage[]): BuilderMessage[][] {
  const turns: BuilderMessage[][] = [];
  for (const message of messages) {
    const turn = turns.at(-1);
    if (message.role === "user" || turn === undefined) turns.push([message]);
    else turn.push(message);
  }
  return turns;
}

function sizeOf(history: ModelHistory): number {
  return (history.summary?.length ?? 0) + JSON.stringify(history.messages).length;
}

// The `fast` role's summary of the older messages, folding in the summary so far; undefined
// when the credit check refuses it, the call fails, or it comes back empty.
async function summarize(
  ctx: Ctx,
  earlier: string | null,
  older: ModelMessage[],
): Promise<string | undefined> {
  const transcript = transcriptOf(older);
  try {
    const { output } = await callModel(ctx, "fast", {
      system: historyPrompts.summaryInstructions(),
      prompt:
        earlier === null
          ? historyPrompts.summarize({ transcript })
          : historyPrompts.summarizeAgain({ summary: earlier, transcript }),
      purpose: "builder",
    });
    const summary = output.trim();
    return summary === "" ? undefined : summary;
  } catch (error) {
    if (error instanceof OutOfCreditsError || error instanceof ModelCallError) return undefined;
    throw error;
  }
}

// The messages as lines, each marked with who said it: the admins' words and try-it summaries,
// and the agent's words and tool calls. Their results aren't sent (the agent's words say what
// it made of them), so neither is any example `read_examples` showed.
function transcriptOf(messages: ModelMessage[]): string {
  return messages
    .flatMap((message) => {
      if (message.role === "user") return [`Admin: ${contentText(message.content)}`];
      if (message.role !== "assistant") return [];
      if (typeof message.content === "string") return [`Builder: ${message.content}`];
      return message.content.flatMap((part) => {
        if (part.type === "text") return [`Builder: ${part.text}`];
        if (part.type === "tool-call") {
          return [`Builder called ${part.toolName}: ${JSON.stringify(part.input)}`];
        }
        return [];
      });
    })
    .join("\n");
}

function contentText(content: Extract<ModelMessage, { role: "user" }>["content"]): string {
  if (typeof content === "string") return content;
  return content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}
