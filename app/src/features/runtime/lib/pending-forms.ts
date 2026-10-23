// The pending-form adapter seam (ADR-0013): every `external_send` catalog action holds what it
// prepared in its app's own pending form (a Gmail draft, or a Calendar event with no guests;
// M11 adds suggested edits in a Doc), and a custom write, whose app has none, is held by Mycel
// itself (ADR-0020). One adapter per pending form is the only code that prepares, carries out,
// removes, checks or shows a waiting item. The `reviews` feature calls
// adapters only, chosen by the review's kind, and never the app's API.
import type { Ctx } from "@/lib/ctx";
import type { PendingDetails } from "../types";

/** Where a waiting item is: pointers only, never its content (invariant 8). */
export type PendingItem = {
  /** The connection it waits on; every operation acts through it. */
  connectionId: string;
  /**
   * The item in its app: a Gmail draft's ID, an escalated message's (its source_ref), a held
   * send's, or a Calendar event's.
   */
  itemRef: string;
  /** The thread it belongs to: a Gmail thread's ID, or a held send's or an event's own ID. */
  threadRef: string;
  /** The message (or invite) that started the run that prepared it. */
  sourceRef: string;
  /** When its review was created: only what happened after it can have finished it. */
  createdAt: Date;
  /** What approving it needs that its app doesn't hold yet: a booked event's guests. */
  details: PendingDetails | null;
};

/**
 * What an adapter's `prepare` made: the pointers a review keeps, and what approving it will need
 * that the app doesn't hold yet, if anything.
 */
export type PreparedItem = { itemRef: string; threadRef: string; details?: PendingDetails };

/**
 * Where a waiting item stands in its app: still waiting, finished there by the person (a draft
 * sent from Gmail), or gone without being finished (a draft deleted).
 */
export type ItemState = "waiting" | "done_in_app" | "gone";

/**
 * A person's changes to a waiting item before approving it, held in memory only: a draft's new
 * text, or new values for a held send's editable text fields, by input name.
 */
export type ReviewEdits = { text: string } | { fields: Record<string, string> };

/** An email as the Reviews page shows it, fetched live and never stored. */
export type MailView = { from: string; to: string; subject: string; date: string; text: string };

/** One input a held send sends: its value, and whether the person may edit it. */
export type HeldSendField = { name: string; description: string; value: string; editable: boolean };

/**
 * A booked meeting as its review shows it: the event as it is on the calendar now, with a link
 * to it and its Meet link, if any, and the guests approving invites and how it then shows.
 */
export type EventView = {
  kind: "event";
  title: string;
  description: string;
  start: string;
  end: string;
  location: string;
  link: string;
  meetLink: string | null;
  guests: string[];
  visibility: PendingDetails["visibility"];
  transparency: PendingDetails["transparency"];
};

/**
 * A waiting item as its review shows it, fetched live: for a Gmail draft, the message it
 * replies to (null when that message is gone) and the draft itself; for an escalated message,
 * the message and a link to it in Gmail; for a held send, the app, the custom action, the
 * request's method and address, and each input it sends, decrypted in memory; for a booked
 * meeting, the event.
 */
export type ItemView =
  | EventView
  | { kind: "draft"; message: MailView | null; draft: MailView }
  | { kind: "message"; message: MailView; link: string }
  | {
      kind: "held_send";
      app: string;
      action: string;
      description: string;
      method: string;
      url: string;
      fields: HeldSendField[];
    };

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
  /**
   * For a pending form Mycel holds itself: deletes everything it holds from before `before`,
   * whether or not a review still waits on it. None for an item its app holds.
   */
  purge?(ctx: Ctx, before: Date): Promise<void>;
};
