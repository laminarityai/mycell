// list_reviews and list_workflows (#181): what waits for the person and what they've switched on,
// as the person: an admin's lists are a member's with the same reviews and switches. Approving,
// editing and declining stay on the Reviews page. Names are screened before the model reads
// them; the conversation keeps only the IDs listed, and the page reads them again to show each
// one with its link (`found.ts`).
import { z } from "zod";
import { listOwnReviews } from "@/features/reviews/server";
import type { ReviewSummary } from "@/features/reviews/types";
import { listOwnEnablements, pausedText } from "@/features/workflows/server";
import type { OwnEnablement } from "@/features/workflows/types";
import { toolPrompts } from "./prompts";
import { noteFor, screenItems } from "./screen";
import type { AgentToolDefinition } from "./tools";

/** The most of either list one call hands the model. */
const MAX_LISTED = 25;

const noInput = z.object({});

type Unavailable = { available: false; message: string };

type ModelReview = {
  reviewId: string;
  workflow: string;
  kind: ReviewSummary["kind"];
  waitingSince: string;
  link: string;
};

type Reviews = {
  available: true;
  reviews: ModelReview[];
  total: number;
  screenedOut: number;
  note?: string;
};

/** What the conversation keeps of list_reviews: the IDs listed. */
export const storedReviewsSchema = z.union([
  z.object({ available: z.literal(false) }),
  z.object({ available: z.literal(true), reviewIds: z.array(z.string()), screenedOut: z.number() }),
]);

export const listReviewsTool: AgentToolDefinition<
  z.infer<typeof noInput>,
  Reviews | Unavailable
> = {
  description: toolPrompts.listReviews(),
  inputSchema: noInput,
  async execute(ctx) {
    const waiting = await listOwnReviews(ctx);
    const shown = waiting.slice(0, MAX_LISTED);
    const screened = await screenItems(ctx, shown, (review) => review.workflowName);
    if (!screened.ok) return unavailable();
    return {
      available: true,
      reviews: screened.kept.map((review) => ({
        reviewId: review.id,
        workflow: review.workflowName,
        kind: review.kind,
        waitingSince: review.createdAt.toISOString(),
        link: reviewHref(review.id),
      })),
      total: waiting.length,
      screenedOut: screened.dropped,
      ...noteFor(screened.dropped),
    };
  },
  stored: (output): z.infer<typeof storedReviewsSchema> =>
    output.available
      ? {
          available: true,
          reviewIds: output.reviews.map((review) => review.reviewId),
          screenedOut: output.screenedOut,
        }
      : { available: false },
};

type ModelWorkflow = {
  workflowId: string;
  name: string;
  status: "on" | "paused";
  /** Why it's paused, in the Workflows page's words. */
  paused?: string;
};

type Workflows = {
  available: true;
  workflows: ModelWorkflow[];
  total: number;
  screenedOut: number;
  note?: string;
};

/** What the conversation keeps of list_workflows: the IDs listed. */
export const storedWorkflowsSchema = z.union([
  z.object({ available: z.literal(false) }),
  z.object({
    available: z.literal(true),
    workflowIds: z.array(z.string()),
    screenedOut: z.number(),
  }),
]);

export const listWorkflowsTool: AgentToolDefinition<
  z.infer<typeof noInput>,
  Workflows | Unavailable
> = {
  description: toolPrompts.listWorkflows(),
  inputSchema: noInput,
  async execute(ctx) {
    const switchedOn = await listOwnEnablements(ctx);
    const shown = switchedOn.slice(0, MAX_LISTED);
    const screened = await screenItems(ctx, shown, (enablement) => enablement.name);
    if (!screened.ok) return unavailable();
    return {
      available: true,
      workflows: screened.kept.map(modelWorkflow),
      total: switchedOn.length,
      screenedOut: screened.dropped,
      ...noteFor(screened.dropped),
    };
  },
  stored: (output): z.infer<typeof storedWorkflowsSchema> =>
    output.available
      ? {
          available: true,
          workflowIds: output.workflows.map((workflow) => workflow.workflowId),
          screenedOut: output.screenedOut,
        }
      : { available: false },
};

/** Why a workflow switched on is paused, in words; null while it runs. */
export function pausedWords(enablement: OwnEnablement): string | null {
  const reason = enablement.pauses.at(0);
  return reason === undefined ? null : pausedText(reason, enablement.pausedChange);
}

function modelWorkflow(enablement: OwnEnablement): ModelWorkflow {
  const paused = pausedWords(enablement);
  return {
    workflowId: enablement.workflowId,
    name: enablement.name,
    ...(paused === null ? { status: "on" as const } : { status: "paused" as const, paused }),
  };
}

export const reviewHref = (reviewId: string) => `/reviews/${encodeURIComponent(reviewId)}`;

const unavailable = (): Unavailable => ({
  available: false,
  message: toolPrompts.listUnavailable(),
});
