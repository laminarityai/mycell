// Why a switch is paused, in the words the Workflows pages show it with: a pause always says why
// (GLOSSARY.md, "Paused"), what it means and what lifts it.
import type { PausedChange, PausedReason, WorkflowSwitch } from "../types";
import { riskLabel } from "./risk-badge";

/** Why it's paused, in a phrase after "Paused:": "out of credits". */
export function pausedText(reason: PausedReason, change: PausedChange | null): string {
  switch (reason) {
    case "out_of_credits":
      return "out of credits";
    case "failures":
      return "failing, an admin will look at it";
    case "needs_reenable":
      if (change?.maxRiskRaised !== undefined) return "needs your OK for a riskier version";
      if (change?.newApps !== undefined) return "needs your OK for a new app";
      return "needs your OK for more access to your Google account";
  }
}

/** What a pause means, in a sentence, for the notice under its badge. */
export function pauseMeaning(reason: PausedReason): string {
  switch (reason) {
    case "out_of_credits":
      return "Your company has run out of credits, so no workflow starts new runs.";
    case "failures":
      return "Its last three runs failed, so it starts no new runs until an admin has looked at it. It isn't anything you did.";
    case "needs_reenable":
      return "An admin published a new version that needs more than the one you switched on.";
  }
}

/**
 * What lifts a pause, in a sentence or two, and whether the switch stays on meanwhile: every
 * pause keeps it but `needs_reenable`, which waits for its user to switch it on again.
 */
export function pauseLift(reason: PausedReason, kind: WorkflowSwitch["kind"]): string {
  switch (reason) {
    case "out_of_credits":
      return [
        "It starts again by itself once your company has more credits.",
        "Messages that arrive until then aren't run later.",
        kind === "member" ? "Your switch stays on." : "Its switch stays on.",
      ].join(" ");
    case "failures":
      return [
        "It starts again once an admin resumes it.",
        "Messages that arrive until then aren't run later.",
        kind === "member" ? "Your switch stays on." : "Its switch stays on.",
      ].join(" ");
    case "needs_reenable":
      return "It stays paused until you switch it on again.";
  }
}

/** What the versions published since it was switched on need that it didn't, a sentence each. */
export function pausedChangeText(change: PausedChange | null): string[] {
  if (change === null) return [];
  const { maxRiskRaised: raised, newApps, newScopes } = change;
  return [
    ...(raised === undefined
      ? []
      : [`Its risk level went up from ${riskLabel(raised.from)} to ${riskLabel(raised.to)}.`]),
    ...(newApps === undefined ? [] : [`It now uses ${newApps.join(" and ")}.`]),
    ...(newScopes === undefined
      ? []
      : [`It now needs Google's ${newScopes.join(", ")} permission.`]),
  ];
}
