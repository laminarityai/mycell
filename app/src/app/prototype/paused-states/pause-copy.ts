// PROTOTYPE, throwaway: what each pause says: why it holds, what lifts it, and whether the
// person's switch is kept (every pause but "needs your OK" keeps it, issue 152 story 14 and
// issue 153 story 36).
import type { PausedReason } from "../_shared/fixtures";
import type { PauseRow } from "./paused-fixtures";

const NUMBER = new Intl.NumberFormat("en-US");

/** One sentence: why this switch is paused for this reason. */
export function whyText(row: PauseRow, reason: PausedReason): string {
  switch (reason) {
    case "out_of_credits":
      return "Your company has run out of credits, so no workflow starts new runs.";
    case "failures":
      return "Its last 3 runs failed in a row, so Mycel stopped it before it failed again.";
    case "budget_reached":
      return row.budget === undefined
        ? "It has spent its credit budget for this month."
        : `It has spent ${NUMBER.format(row.budget.spent)} of its ${NUMBER.format(row.budget.limit)} credit budget this month.`;
    case "needs_reenable":
      return row.riskRaised === undefined
        ? "An admin published a version that needs more than the one you switched on."
        : `An admin published version ${String(row.riskRaised.version)}. Its risk level went up from ${row.riskRaised.from} to ${row.riskRaised.to}.`;
  }
}

/** One sentence: what lifts it, for the person looking. */
export function liftText(reason: PausedReason, admin: boolean): string {
  switch (reason) {
    case "out_of_credits":
      return admin
        ? "It starts again by itself as soon as the Mycel team grants more credits."
        : "It starts again by itself when your company gets more credits. Nothing to do.";
    case "failures":
      return admin
        ? "Look at the runs that failed, then resume it."
        : "An admin will look at it and resume it. Nothing to do.";
    case "budget_reached":
      return admin
        ? "It starts again on Nov 1, or now if you raise or remove its budget."
        : "It starts again on Nov 1, or sooner if an admin raises its budget.";
    case "needs_reenable":
      return "It stays paused until you switch it on again.";
  }
}

/** A short name for the event that lifts it, for timelines: "Credits granted". */
export const LIFT_EVENT: Record<PausedReason, string> = {
  out_of_credits: "Credits granted",
  failures: "An admin resumes it",
  budget_reached: "Nov 1, or budget raised",
  needs_reenable: "You switch it on again",
};

/** Whether the person's switch stays on through this pause. */
export const keepsSwitch = (reason: PausedReason) => reason !== "needs_reenable";

/** What a switch is when no pause holds. */
export function runningText(row: PauseRow): string {
  if (!row.on) return "Off";
  return row.kind === "member" ? "On for your Google account" : "On for the shared inbox";
}

/** When a pause in front hides "needs your OK": the member can act now, not after it lifts. */
export function alsoNeedsOk(row: PauseRow): string | null {
  const shown = row.reasons.at(0);
  if (shown === undefined || shown === "needs_reenable") return null;
  if (!row.reasons.includes("needs_reenable")) return null;
  return "It also needs your OK for a riskier version: re-enable it now and it starts as soon as this lifts.";
}
