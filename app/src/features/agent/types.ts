// The agent feature's public types: a person's Ask Mycel conversations, their stored messages,
// the citations their replies show, and the UI messages the chat page streams.
import { z } from "zod";
import { chatPartSchemas, type ChatUIMessage } from "@/features/models/types";

/**
 * One part of a stored message: the parts every chat stores (text, one tool call with its
 * result as that tool stores it, or a notice; `models`' `chatPartSchemas`). A tool keeps only
 * IDs of what it read (fact and object IDs), never what a fact says or fetched content
 * (invariant 8). The agent's own kinds (a pending run, a remembered fact) join this union as
 * they're built.
 */
export const storedPartSchema = z.discriminatedUnion("type", [...chatPartSchemas]);
export type StoredPart = z.infer<typeof storedPartSchema>;

/** A message of a conversation: the person's or Mycel's. */
export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  parts: StoredPart[];
  createdAt: Date;
};

/** A row of the conversation rail. `title` is null until its first message. */
export type AgentConversationSummary = { id: string; title: string | null; updatedAt: Date };

/** Where a cited fact's source is, as the person may open it. */
export type CitedSource = {
  /** One per item: copies of one email, doc or invite are one source. */
  key: string;
  kind: "email" | "doc" | "invite";
  occurredAt: Date;
  /**
   * The email in the person's own Gmail (their copy by its ID, anyone else's by its Message-ID)
   * the doc in Drive, or the invite in their own calendar; null when no link reaches it (a
   * colleague's email with no Message-ID, or an invite on someone else's calendar).
   */
  href: string | null;
  /** The copy is in the person's own mailbox, Drive or calendar. */
  yours: boolean;
};

/** Text split around the words a search matched, in order, for highlighting. */
export type MarkedText = { text: string; match: boolean }[];

/** One of the person's conversations a search found, as the rail shows it. */
export type ConversationHit = AgentConversationSummary & {
  /** The whole title, split around the words that matched; null when the title didn't match. */
  titleMatch: MarkedText | null;
  /**
   * A stretch of its best-matching message, the person's or Mycel's, split the same way; null
   * when only the title matched.
   */
  snippet: MarkedText | null;
};

/** What the rail lists: the person's conversations, or the conversations their search found. */
export type RailList =
  | { query: null; conversations: AgentConversationSummary[] }
  | { query: string; hits: ConversationHit[] };

// A query parameter's one value: the first of several, trimmed, and none for a blank one.
const queryValue = (value: unknown) => {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() !== "" ? first.trim() : undefined;
};

/** Ask Mycel's address query: `q`, the rail's search, when there is one. */
export const askQuerySchema = z.object({
  q: z.preprocess(queryValue, z.string().optional()).catch(undefined),
});

/** A fact a reply read, with its sources and markers in the person's view, never its words. */
export type Citation = {
  factId: string;
  /** It contradicts a fact from inside the company, or a company-wide one. */
  disputed: boolean;
  /** Only someone outside the company states it, as far as the person's sources show. */
  outsideOnly: boolean;
  sources: CitedSource[];
};

export type AgentConversation = AgentConversationSummary & {
  createdAt: Date;
  /** Oldest first. */
  messages: AgentMessage[];
  /** The facts its replies read that the person can still see. */
  citations: Citation[];
};

/** The chat page's messages: the AI SDK's UI messages, with notices. */
export type AgentUIMessage = ChatUIMessage;
