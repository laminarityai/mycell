// What a conversation's mail and work tools found, read again whenever the conversation is
// shown, from the pointers its tool parts keep: each message's sender and subject fetched from
// the person's own Gmail (never stored, invariant 8), and each review and workflow as it stands
// now in the person's view. What's gone, or no longer theirs, isn't shown. However many tool
// parts there are, it's one read of each kind.
import type { z } from "zod";
import { readMessageHeaders } from "@/features/runtime/server";
import type { MessageRef } from "@/features/runtime/types";
import { listOwnReviews } from "@/features/reviews/server";
import { listOwnEnablements } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import type { AgentMessage, FoundItems, FoundMessage } from "../types";
import { storedFindSchema } from "./mail-tools";
import { pausedWords, reviewHref, storedReviewsSchema, storedWorkflowsSchema } from "./work-tools";

export async function foundIn(ctx: Ctx, messages: AgentMessage[]): Promise<FoundItems> {
  const refs = new Map<string, MessageRef>();
  for (const output of outputsOf(messages, "find_messages", storedFindSchema)) {
    if (!("messages" in output)) continue;
    for (const ref of output.messages) refs.set(refKey(ref), ref);
  }
  const reviewIds = new Set(
    outputsOf(messages, "list_reviews", storedReviewsSchema).flatMap((output) =>
      output.available ? output.reviewIds : [],
    ),
  );
  const workflowIds = new Set(
    outputsOf(messages, "list_workflows", storedWorkflowsSchema).flatMap((output) =>
      output.available ? output.workflowIds : [],
    ),
  );
  const [headers, reviews, workflows] = await Promise.all([
    readMessageHeaders(ctx, [...refs.values()]),
    reviewIds.size === 0 ? [] : listOwnReviews(ctx),
    workflowIds.size === 0 ? [] : listOwnEnablements(ctx),
  ]);
  return {
    messages: headers.map((message): FoundMessage => ({
      connectionId: message.connectionId,
      sourceRef: message.sourceRef,
      from: message.from,
      subject: message.subject,
      receivedAt: message.receivedAt,
      href: `https://mail.google.com/mail/?authuser=${encodeURIComponent(message.accountEmail)}#all/${encodeURIComponent(message.sourceRef)}`,
    })),
    reviews: reviews
      .filter((review) => reviewIds.has(review.id))
      .map((review) => ({
        id: review.id,
        workflowName: review.workflowName,
        kind: review.kind,
        createdAt: review.createdAt,
        href: reviewHref(review.id),
      })),
    workflows: workflows
      .filter((enablement) => workflowIds.has(enablement.workflowId))
      .map((enablement) => ({
        id: enablement.workflowId,
        name: enablement.name,
        paused: pausedWords(enablement),
      })),
  };
}

/** One key per message: its connection and its Gmail ID. */
export const refKey = (ref: MessageRef) => `${ref.connectionId}\n${ref.sourceRef}`;

// What each of the conversation's successful calls of `tool` stored, as `schema` reads it.
function outputsOf<T>(messages: AgentMessage[], tool: string, schema: z.ZodType<T>): T[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (part.type !== "tool" || part.isError || part.toolName !== tool) return [];
      const parsed = schema.safeParse(part.output);
      return parsed.success ? [parsed.data] : [];
    }),
  );
}
