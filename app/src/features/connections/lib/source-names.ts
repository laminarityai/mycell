import { GOOGLE_APP_NAMES } from "@/lib/google";
import { REGISTERED_APPS } from "../registered-apps";
import type { ConnectionKind, GoogleApp, Source } from "../types";

/** How the UI names each source: its registered app, or a one-app connection's app. */
export const SOURCE_NAMES: Record<Source, string> = {
  google: REGISTERED_APPS.google.name,
  microsoft: REGISTERED_APPS.microsoft.name,
  gmail: "Gmail",
  drive: "Google Drive",
};

/** Names apps as a list: "Gmail", "Gmail and Drive", "Gmail, Drive and Sheets". */
export function appList(apps: readonly GoogleApp[]): string {
  const names = apps.map((app) => GOOGLE_APP_NAMES[app]);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/** How the UI names what a connect attempt is connecting, such as "Google" or "an org inbox". */
export function attemptTarget(attempt: { source: Source; kind: ConnectionKind }): string {
  const orgTargets: Record<Source, string> = {
    google: "an org Google account",
    microsoft: "an org Microsoft 365 account",
    gmail: "an org inbox",
    drive: "an org Drive",
  };
  return attempt.kind === "org" ? orgTargets[attempt.source] : SOURCE_NAMES[attempt.source];
}
