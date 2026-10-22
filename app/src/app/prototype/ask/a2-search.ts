// PROTOTYPE, throwaway: variant A2's conversation search. A conversation matches when its title
// or any message's words contain the query; a hit shows the first matching stretch as a snippet.
// The real search would run on the server over the person's own conversations only.
import { workflowById } from "../_shared/fixtures";
import {
  OUT_OF_CREDITS,
  REMOVED,
  type ConversationSummary,
  type Message,
  type Part,
} from "./conversation";
import { FACTS } from "./facts";

/** The words a part shows, as one string. */
function partText(part: Part): string {
  switch (part.kind) {
    case "text":
    case "unknown":
    case "screened":
    case "refusal":
      return part.text;
    case "answer":
      return part.lines.map((line) => line.text).join(" ");
    case "summary":
      return [part.intro, ...part.factIds.map((id) => FACTS[id].statement)].join(" ");
    case "messages":
      return part.messages.map((m) => `${m.from} ${m.subject}`).join(" ");
    case "proposedRun":
      return `Run ${workflowById(part.workflowId)?.name ?? ""} on ${part.message.subject}`;
    case "remembered":
      return `${part.statement} ${part.about.name}`;
    case "removed":
      return REMOVED;
    case "outOfCredits":
      return OUT_OF_CREDITS;
    case "reviews":
      return part.reviews.map((r) => r.title).join(" ");
    case "workflows":
      return part.workflowIds.map((id) => workflowById(id)?.name ?? "").join(" ");
    case "noConnection":
      return "";
  }
}

export type SearchHit = {
  conversation: ConversationSummary;
  /** Where the title matches, if it does. */
  titleMatch: boolean;
  /** The stretch of a message around the first match, with the matched words split out. */
  snippet?: { before: string; match: string; after: string };
};

const BEFORE = 28;
const AFTER = 64;

function snippetOf(text: string, at: number, length: number): NonNullable<SearchHit["snippet"]> {
  const start = Math.max(0, at - BEFORE);
  const end = Math.min(text.length, at + length + AFTER);
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, at).trimStart(),
    match: text.slice(at, at + length),
    after: text.slice(at + length, end).trimEnd() + (end < text.length ? "…" : ""),
  };
}

/** The conversations matching `query`, in the list's order. An empty query matches none. */
export function searchConversations(
  query: string,
  conversations: ConversationSummary[],
  threads: Record<string, Message[] | undefined>,
): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  return conversations.flatMap((conversation): SearchHit[] => {
    const titleMatch = conversation.title.toLowerCase().includes(needle);
    for (const message of threads[conversation.id] ?? []) {
      const text = message.parts.map(partText).join(" ").replace(/\s+/g, " ");
      const at = text.toLowerCase().indexOf(needle);
      if (at >= 0) {
        return [{ conversation, titleMatch, snippet: snippetOf(text, at, needle.length) }];
      }
    }
    return titleMatch ? [{ conversation, titleMatch }] : [];
  });
}

/** `text` split around each case-insensitive occurrence of `query`, for highlighting. */
export function splitOnMatch(text: string, query: string): { text: string; hit: boolean }[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [{ text, hit: false }];
  const pieces: { text: string; hit: boolean }[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    if (at > from) pieces.push({ text: text.slice(from, at), hit: false });
    pieces.push({ text: text.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
  }
  if (from < text.length) pieces.push({ text: text.slice(from), hit: false });
  return pieces;
}
