// The builder feature's public types: builder conversations, their stored messages, and the
// UI messages the chat page streams.
import type { UIMessage } from "ai";
import { z } from "zod";

/** Why the agent's turn shows a notice instead of (or after) a reply. */
export const noticeKindSchema = z.enum(["out_of_credits", "failed"]);
export type NoticeKind = z.infer<typeof noticeKindSchema>;

export type Notice = { kind: NoticeKind; text: string };

/**
 * One part of a stored message: text, one tool call with its result, or a notice. A tool's
 * result is stored as the tool chooses (`read_examples` keeps only source refs), never as
 * source content (invariant 8).
 */
export const storedPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool"),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
    /** What the tool returned, or the error the model was told about. */
    output: z.unknown(),
    isError: z.boolean(),
  }),
  z.object({ type: z.literal("notice"), kind: noticeKindSchema, text: z.string() }),
]);
export type StoredPart = z.infer<typeof storedPartSchema>;

/** A message of a builder conversation: an admin's or the agent's. */
export type BuilderMessage = {
  id: string;
  role: "user" | "assistant";
  /** The admin who wrote it; null for the agent's. */
  authorId: string | null;
  parts: StoredPart[];
  createdAt: Date;
};

/** A row of the conversation list. */
export type ConversationSummary = {
  id: string;
  title: string | null;
  startedBy: string;
  workflowId: string | null;
  updatedAt: Date;
};

export type BuilderConversation = ConversationSummary & {
  createdAt: Date;
  /** Oldest first. */
  messages: BuilderMessage[];
};

/** The chat page's messages: the AI SDK's UI messages, with notices as a data part. */
export type BuilderUIMessage = UIMessage<never, { notice: Notice }>;
