// Why an enablement is paused, in the words the Workflows pages show it with: a pause always
// says why (GLOSSARY.md, "Paused").
import type { PausedChange, PausedReason } from "../types";
import { riskLabel } from "./risk-badge";

/** Why it's paused, in a phrase after "Paused:": "needs your OK for a riskier version". */
export function pausedText(reason: PausedReason | null, change: PausedChange | null): string {
  if (reason === null) return "no reason given";
  if (change?.maxRiskRaised !== undefined) return "needs your OK for a riskier version";
  if (change?.newApps !== undefined) return "needs your OK for a new app";
  return "needs your OK for more access to your Google account";
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
