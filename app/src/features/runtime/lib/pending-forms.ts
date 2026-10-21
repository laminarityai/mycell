// The pending-form adapter seam (ADR-0013): every `external_send` catalog action holds what it
// prepared in its app's own pending form (a Gmail draft; M11 adds a Calendar event with no
// guests and suggested edits in a Doc), and one adapter per pending form is the only code that
// prepares, carries out, removes, checks or shows a waiting item. The `reviews` feature calls
// adapters only, chosen by the review's kind, and never the app's API.
import type { Ctx } from "@/lib/ctx";

/** Where a waiting item is: pointers only, never its content (invariant 8). */
export type PendingItem = {
  /** The connection it waits on; every operation acts through it. */
  connectionId: string;
  /** The item in its app: a Gmail draft's ID, or an escalated message's (its source_ref). */
  itemRef: string;
  /** The thread it belongs to: a Gmail thread's ID. */
  threadRef: string;
  /** The message that started the run that prepared it. */
  sourceRef: string;
  /** When its review was created: only what happened after it can have finished it. */
  createdAt: Date;
};

/** What an adapter's `prepare` made: the pointers a review keeps. */
export type PreparedItem = { itemRef: string; threadRef: string };

/**
 * Where a waiting item stands in its app: still waiting, finished there by the person (a draft
 * sent from Gmail), or gone without being finished (a draft deleted).
 */
export type ItemState = "waiting" | "done_in_app" | "gone";

/** A person's changes to a waiting item before approving it, held in memory only. */
export type ReviewEdits = { text: string };

/** An email as the Reviews page shows it, fetched live and never stored. */
export type MailView = { from: string; to: string; subject: string; date: string; text: string };

/**
 * A waiting item as its review shows it, fetched live: for a Gmail draft, the message it
 * replies to (null when that message is gone) and the draft itself; for an escalated message,
 * the message and a link to it in Gmail.
 */
export type ItemView =
  | { kind: "draft"; message: MailView | null; draft: MailView }
  | { kind: "message"; message: MailView; link: string };

/**
 * One pending form's adapter. `Input` is what its catalog action's executor hands `prepare`.
 * Every operation acts with the caller's ctx through the item's own connection.
 */
export type PendingFormAdapter<Input = never> = {
  /** Creates the waiting item in its app. */
  prepare(ctx: Ctx, input: Input): Promise<PreparedItem>;
  /**
   * Carries the item out, with the person's edits, if any; for a read-only item (an escalated
   * message), records nothing in its app: the person is done with it. ItemGoneError if it's gone.
   */
  approve(ctx: Ctx, item: PendingItem, edits?: ReviewEdits): Promise<void>;
  /** Removes the waiting item. ItemGoneError if it's already gone. None for a read-only item. */
  decline?(ctx: Ctx, item: PendingItem): Promise<void>;
  /** Where the item stands in its app. */
  check(ctx: Ctx, item: PendingItem): Promise<ItemState>;
  /** The item as the review shows it, fetched live. ItemGoneError if it's gone. */
  view(ctx: Ctx, item: PendingItem): Promise<ItemView>;
};
