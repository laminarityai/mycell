import type { ConnectionKind, Source } from "../types";

/** How the UI names each source. */
export const SOURCE_NAMES: Record<Source, string> = { gmail: "Gmail", drive: "Google Drive" };

/** How the UI names what a connect attempt is connecting, such as "Gmail" or "an org inbox". */
export function attemptTarget(attempt: { source: Source; kind: ConnectionKind }): string {
  const orgTargets: Record<Source, string> = { gmail: "an org inbox", drive: "an org Drive" };
  return attempt.kind === "org" ? orgTargets[attempt.source] : SOURCE_NAMES[attempt.source];
}
