// PROTOTYPE, throwaway: the words the Reviews page uses for M11's kinds: their labels, what
// approving and declining do, and how each one ends ("done in the app", "gone").
import { NOW } from "../_shared/fixtures";
import type { App, ReviewFx } from "./review-fixtures";

export const KIND_LABELS: Record<ReviewFx["kind"], string> = {
  draft_reply: "Draft reply",
  escalation: "Escalated message",
  event: "Calendar event",
  suggestions: "Doc edits",
};

export const APP_NAMES: Record<App, string> = {
  gmail: "Gmail",
  calendar: "Calendar",
  docs: "Docs",
};

/** The `state` toggle: whether the opened Calendar and Docs reviews still wait. */
export type Ending = "waiting" | "done_in_app" | "gone";

export const asEnding = (value: string): Ending =>
  value === "done_in_app" || value === "gone" ? value : "waiting";

/** What a review's own buttons do, by kind. */
export function actionLabels(review: ReviewFx): { approve: string; decline: string } {
  switch (review.kind) {
    case "draft_reply":
      return { approve: "Approve and send", decline: "Decline" };
    case "escalation":
      return { approve: "Mark done", decline: "Hand back" };
    case "event":
      return {
        approve: review.guests.length === 1 ? "Approve and invite" : "Approve and invite all",
        decline: "Decline and delete event",
      };
    case "suggestions":
      return {
        approve: `Accept all ${String(review.open)}`,
        decline: `Reject all ${String(review.open)}`,
      };
  }
}

/** The sentence after a person approves or declines here. */
export function decidedText(review: ReviewFx, approved: boolean): string {
  switch (review.kind) {
    case "draft_reply":
      return approved ? "Approved and sent." : "Declined, and its draft deleted.";
    case "escalation":
      return approved ? "Marked done." : "Handed back.";
    case "event":
      return approved
        ? `Approved. ${guestsText(review.guests.length)} invited, and the event now shows as busy.`
        : "Declined, and the event deleted from your calendar.";
    case "suggestions":
      return approved
        ? `Approved. Mycel's ${String(review.open)} suggestions were accepted in the doc.`
        : `Declined. Mycel's ${String(review.open)} suggestions were rejected in the doc.`;
  }
}

/** How a Calendar or Docs review ended without anyone acting in Mycel. */
export function endedText(review: ReviewFx, ending: Exclude<Ending, "waiting">): string {
  if (review.kind === "event") {
    return ending === "done_in_app"
      ? "Done in the app: the guests were added in Calendar, so this review closed."
      : "Gone: the event is no longer on your calendar.";
  }
  if (review.kind === "suggestions") {
    return ending === "done_in_app"
      ? "Done in the app: every Mycel suggestion was accepted or rejected in Docs, so this review closed by itself."
      : "Gone: the doc was deleted, or you can no longer open it.";
  }
  return ending === "done_in_app" ? "Done in the app: it was sent from Gmail." : "Gone.";
}

export const guestsText = (count: number) => (count === 1 ? "1 guest" : `${String(count)} guests`);

/** How long a review has waited, in its largest whole unit. */
export function age(since: Date): string {
  const minutes = Math.max(0, Math.floor((NOW.getTime() - since.getTime()) / 60_000));
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

function plural(count: number, unit: string) {
  return `${String(count)} ${unit}${count === 1 ? "" : "s"}`;
}

/** "3:00–3:30 PM": the end of an event, for beside its <DateTime> start. */
export const endOf = (start: Date, minutes: number) => new Date(start.getTime() + minutes * 60_000);
