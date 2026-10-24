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
  /** One per item: copies of one email or doc are one source. */
  key: string;
  kind: "email" | "doc";
  occurredAt: Date;
  /**
   * The email in the person's own Gmail (their copy by its ID, anyone else's by its Message-ID)
   * or the doc in Drive; null when no link reaches it (a colleague's email with no Message-ID).
   */
  href: string | null;
  /** The copy is in the person's own mailbox or Drive. */
  yours: boolean;
};

/** A fact a reply read, with its sources and markers in the person's view, never its words. */
export type Citation = {
  factId: string;
  /** It contradicts a fact from inside the company, or a company-wide one. */
  disputed: boolean;
  /** Only someone outside the company states it, as far as the person's sources show. */
  outsideOnly: boolean;
  /** The person told Mycel this ("remember this"): it has no sources, and only they see it. */
  told: boolean;
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
