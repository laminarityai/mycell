// The agent feature's public types: a person's Ask Mycel conversations, their stored messages,
// the citations their replies show, and the UI messages the chat page streams.
import { z } from "zod";
import { chatPartSchemas, type ChatUIMessage } from "@/features/models/types";
import type { RunStatus } from "@/features/runtime/types";

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

/** A fact a reply read, with its sources and markers in the person's view, never its words. */
export type Citation = {
  factId: string;
  /** It contradicts a fact from inside the company, or a company-wide one. */
  disputed: boolean;
  /** Only someone outside the company states it, as far as the person's sources show. */
  outsideOnly: boolean;
  sources: CitedSource[];
};

/**
 * A pending run as the conversation shows it: the workflow `propose_run` offered to run, the
 * message it would run on, and the run Run started. The message's sender, subject and date are
 * fetched from Gmail for display only, never stored (invariant 8); null once Gmail no longer has
 * it. `run` is null until the person presses Run.
 */
export type PendingRun = {
  id: string;
  workflowId: string;
  workflowName: string;
  message: { from: string; subject: string; receivedAt: Date } | null;
  run: { id: string; status: RunStatus } | null;
  createdAt: Date;
};

/** What `propose_run` keeps, and tells the page: the pending run it recorded, or why not. */
export type ProposeRunResult = { proposed: true; pendingRunId: string } | ProposeRunRefusal;

/** Why `propose_run` recorded nothing, in plain words the person and the model both read. */
export type ProposeRunRefusal = { proposed: false; why: string };

export type AgentConversation = AgentConversationSummary & {
  createdAt: Date;
  /** Oldest first. */
  messages: AgentMessage[];
  /** The facts its replies read that the person can still see. */
  citations: Citation[];
  /** The runs its replies offered, oldest first. */
  pendingRuns: PendingRun[];
};

/** The chat page's messages: the AI SDK's UI messages, with notices. */
export type AgentUIMessage = ChatUIMessage;
