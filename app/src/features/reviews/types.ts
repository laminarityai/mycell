// The reviews feature's public types: what a review is, how it ends, and what the Reviews page
// shows of it. A review holds pointers only (invariant 8); its item is fetched live.
import { z } from "zod";
import type { ItemView, PendingFormAdapter } from "@/features/runtime/adapters";

/**
 * What a review waits on, which chooses its pending-form adapter: `approval` is a Gmail draft an
 * `approval` step left waiting; `escalation` is a message an `escalate` step (or a gate's
 * `else: "escalate"`) handed to a person. M11 adds Calendar and Docs.
 */
export const reviewKinds = ["approval", "escalation"] as const;
export type ReviewKind = (typeof reviewKinds)[number];

/**
 * What a person may do with a waiting review of each kind: a draft is approved (as it is, or
 * edited) or declined; an escalated message is only marked done, as Mycel changes nothing in
 * Gmail for it.
 */
export const reviewActions = {
  approval: ["approve", "edit", "decline"],
  escalation: ["done"],
} as const satisfies Record<ReviewKind, readonly string[]>;
export type ReviewAction = (typeof reviewActions)[ReviewKind][number];

/**
 * The pending-form adapter for each review kind: the only way `reviews` reaches an app. Acting
 * and opening take one, defaulting to the real adapters, so a test can pass fakes.
 */
export type PendingForms = Record<ReviewKind, PendingFormAdapter>;

/**
 * Where a review stands: waiting, or how it ended. `done_in_app` is the person finishing it in
 * the app itself (a draft sent, or an escalated message replied to, from Gmail), or marking an
 * escalation done; `gone` is the item gone with no one finishing it. Reviews never time out.
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
  /** The item in its app: a Gmail draft's ID, or the escalated message's. */
  itemRef: string;
  /** Its thread: a Gmail thread's ID. */
  threadRef: string;
  /** The message that started the run. */
  sourceRef: string;
  /** Why an escalate step handed the message over: the spec's words, never the message's. */
  reason?: string;
};

/** A user, as a review names them. */
export type ReviewPerson = { id: string; name: string };

/** Who a review was last handed to, and who handed it to them. */
export type HandOff = { to: ReviewPerson; by: ReviewPerson };

/**
 * A waiting review as the Reviews page lists it. `sharedWith` is set for an org review, seen by
 * everyone who sees its workflow: the names of the workflow's tags the viewer may know (a
 * member's own among them, every one for an admin), possibly none. It's null for a review in
 * someone's own mailbox. `handOff` says who it was handed to, if anyone.
 */
export type ReviewSummary = {
  id: string;
  kind: ReviewKind;
  workflowId: string;
  workflowName: string;
  sharedWith: string[] | null;
  handOff: HandOff | null;
  createdAt: Date;
};

/**
 * A review and how it stands: who ended it and when, once it has ended. An escalation has the
 * escalate step's reason for handing the message over; an approval has none.
 */
export type Review = ReviewSummary & {
  reason: string | null;
  status: ReviewStatus;
  endedByUserId: string | null;
  /** The name of whoever ended it in Mycel; null while waiting, or when nobody did. */
  endedBy: string | null;
  endedAt: Date | null;
};

/**
 * An opened review: the review, its item fetched live from its app while it's waiting (null
 * once it has ended; never stored), and the colleagues the caller may hand it to (none when they
 * may not hand it on).
 */
export type OpenedReview = { review: Review; view: ItemView | null; handOffTo: ReviewPerson[] };

/** How many reviews stand each way: waiting, or ended each way. */
export type ReviewCounts = Record<ReviewStatus, number>;

/**
 * Some reviews, counted: approval reviews (drafts) apart from escalations, and the ship bar's
 * share (docs/intent.md): of the approval reviews that ended `approved`, `edited_approved`,
 * `declined` or `gone`, the part `approved`, from 0 to 1, or null while none has. A draft sent
 * from Gmail (`done_in_app`) is left out: Mycel can't tell whether it was edited first.
 */
export type ReviewTally = {
  approvals: ReviewCounts;
  escalations: ReviewCounts;
  approvedWithoutEdits: number | null;
};

/**
 * Which reviews `reviewStats` counts: those of one workflow (or every one), of one person (a
 * member's own, always, for a member), and made since a time or since each workflow's current
 * version (only its runs on that version). `groupBy: "user"`, for admins, counts each person's
 * apart too.
 */
export type ReviewStatsQuery = {
  workflowId?: string;
  userId?: string;
  since: Date | "current_version";
  groupBy?: "user";
};

/**
 * The counts of the reviews asked about, and with `groupBy: "user"` each person's apart: whose
 * mailbox each review's item waited in. `user` is null for a shared inbox's reviews.
 */
export type ReviewStats = ReviewTally & {
  byUser: (ReviewTally & { user: ReviewPerson | null })[];
};

/**
 * The periods review counts are shown over: the last 2, 7 or 30 days, or since each workflow's
 * current version. The Workflows page shows the last 7 days until another is chosen.
 */
export const reviewPeriods = ["2d", "7d", "30d", "current_version"] as const;
export type ReviewPeriod = (typeof reviewPeriods)[number];
export const DEFAULT_REVIEW_PERIOD: ReviewPeriod = "7d";

/** A page's `period` search parameter: one of the periods, or the default for anything else. */
export const reviewPeriodSchema = z.enum(reviewPeriods).catch(DEFAULT_REVIEW_PERIOD);

/** One row of review counts: a workflow's, or (`person`) one person's under it. */
export type ReviewCountsRow = { key: string; label: string; person?: boolean; tally: ReviewTally };
