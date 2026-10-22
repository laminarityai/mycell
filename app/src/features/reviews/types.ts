// The reviews feature's public types: what a review is, how it ends, and what the Reviews page
// shows of it. A review holds pointers only (invariant 8); its item is fetched live.
import { z } from "zod";
import type { ItemView, PendingFormAdapter, ReviewEdits } from "@/features/runtime/adapters";

/**
 * What a review waits on, which chooses its pending-form adapter: `approval` is a Gmail draft an
 * `approval` step left waiting; `escalation` is a message an `escalate` step (or a gate's
 * `else: "escalate"`) handed to a person; `held_send` is a custom write's request, which Mycel
 * holds until the review ends (ADR-0020). M11 adds Calendar and Docs.
 */
export const reviewKinds = ["approval", "escalation", "held_send"] as const;
export type ReviewKind = (typeof reviewKinds)[number];

/**
 * What a person may do with a waiting review of each kind: a draft or a held send is approved
 * (as it is, or edited) or declined; an escalated message is only marked done, as Mycel changes
 * nothing in Gmail for it.
 */
export const reviewActions = {
  approval: ["approve", "edit", "decline"],
  escalation: ["done"],
  held_send: ["approve", "edit", "decline"],
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
 * escalation done; `gone` is the item gone with no one finishing it; `expired` is a held send
 * nobody ended within 30 days, whose request was then deleted (ADR-0020); `unconfirmed` is a held
 * send someone approved whose app didn't confirm it was sent (an error or a lost answer after
 * the request may have reached it), so it may or may not have gone and is never sent again.
 * Reviews of items an app holds never time out.
 */
export const reviewStatuses = [
  "waiting",
  "approved",
  "edited_approved",
  "declined",
  "done_in_app",
  "gone",
  "expired",
  "unconfirmed",
] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];

/** How long a review of each kind Mycel holds the item of may wait before it expires. */
export const REVIEW_EXPIRY_DAYS: Partial<Record<ReviewKind, number>> = { held_send: 30 };

/** What a run hands `createReview`: where the item waits, and the run that prepared it. */
export type NewReview = {
  runId: string;
  /** The connection the item waits on, which acting on the review goes through. */
  connectionId: string;
  /**
   * The run's own connection, which `sourceRef` came from, when it isn't `connectionId`: a held
   * send's review is on the connection to the custom action's app. The review goes with both.
   */
  runConnectionId?: string;
  workflowId: string;
  workflowVersionId: string;
  kind: ReviewKind;
  /** The item in its app: a Gmail draft's ID, the escalated message's, or a held send's. */
  itemRef: string;
  /** Its thread: a Gmail thread's ID, or a held send's own ID. */
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
 * Some reviews, counted: approval reviews (drafts), escalations and held sends apart, and the
 * ship bar's share (docs/intent.md): of the approval reviews that ended `approved`,
 * `edited_approved`, `declined` or `gone`, the part `approved`, from 0 to 1, or null while none
 * has. A draft sent from Gmail (`done_in_app`) is left out: Mycel can't tell whether it was
 * edited first.
 */
export type ReviewTally = {
  approvals: ReviewCounts;
  escalations: ReviewCounts;
  heldSends: ReviewCounts;
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

const FIELD = "field:";

/**
 * The approve form, as its Server Action parses it: the review, and the person's edits, if any.
 * `text` is there only when they edited a draft, and `field:<name>` entries (text, by input
 * name) only when they edited a held send. The edits are held in memory and handed to the
 * adapter, never stored (invariant 8).
 */
export const approveFormSchema = z
  .looseObject({ reviewId: z.string().min(1), text: z.string().optional() })
  .transform(({ reviewId, text, ...entries }) => ({
    reviewId,
    ...(text === undefined ? {} : { text }),
    fields: Object.fromEntries(
      Object.entries(entries).flatMap(([name, value]) =>
        name.startsWith(FIELD) ? [[name.slice(FIELD.length), value]] : [],
      ),
    ),
  }))
  .pipe(
    z
      .object({
        reviewId: z.string(),
        text: z.string().optional(),
        fields: z.record(z.string().min(1), z.string()),
      })
      .transform(({ reviewId, text, fields }): { reviewId: string; edits?: ReviewEdits } => {
        if (text !== undefined) return { reviewId, edits: { text } };
        if (Object.keys(fields).length > 0) return { reviewId, edits: { fields } };
        return { reviewId };
      }),
  );
