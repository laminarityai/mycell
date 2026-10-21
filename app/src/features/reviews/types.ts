// The reviews feature's public types: what a review is, how it ends, and what the Reviews page
// shows of it. A review holds pointers only (invariant 8); its item is fetched live.
import type { ItemView, PendingFormAdapter } from "@/features/runtime/adapters";

/**
 * What a review waits on, which chooses its pending-form adapter: `approval` is a Gmail draft an
 * `approval` step left waiting. #64 adds `escalation`; M11 adds Calendar and Docs.
 */
export const reviewKinds = ["approval"] as const;
export type ReviewKind = (typeof reviewKinds)[number];

/**
 * The pending-form adapter for each review kind: the only way `reviews` reaches an app. Acting
 * and opening take one, defaulting to the real adapters, so a test can pass fakes.
 */
export type PendingForms = Record<ReviewKind, PendingFormAdapter>;

/**
 * Where a review stands: waiting, or how it ended. `done_in_app` is the person finishing it in
 * the app itself (a draft sent from Gmail); `gone` is the item gone with no one finishing it.
 * Reviews never time out.
 */
export const reviewStatuses = [
  "waiting",
  "approved",
  "edited_approved",
  "declined",
  "done_in_app",
  "gone",
] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];

/** What a run hands `createReview`: where the item waits, and the run that prepared it. */
export type NewReview = {
  runId: string;
  connectionId: string;
  workflowId: string;
  workflowVersionId: string;
  kind: ReviewKind;
  /** The item in its app: a Gmail draft's ID. */
  itemRef: string;
  /** Its thread: a Gmail thread's ID. */
  threadRef: string;
  /** The message that started the run. */
  sourceRef: string;
};

/** A waiting review as the Reviews page lists it. */
export type ReviewSummary = {
  id: string;
  kind: ReviewKind;
  workflowId: string;
  workflowName: string;
  createdAt: Date;
};

/** A review and how it stands: who ended it and when, once it has ended. */
export type Review = ReviewSummary & {
  status: ReviewStatus;
  endedByUserId: string | null;
  endedAt: Date | null;
};

/**
 * An opened review: the review, and its item fetched live from its app while it's waiting
 * (null once it has ended). Never stored.
 */
export type OpenedReview = { review: Review; view: ItemView | null };
