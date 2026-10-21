// What a workflow version needs from the Google connection it runs on: the apps it uses
// (ADR-0014) and the scope of each catalog action it calls. Both come from the catalog, never
// from a model.
import { GOOGLE_APP_SCOPES, type GoogleApp } from "@/features/connections/types";
import { appsUsed, findAction } from "@/features/policy/catalog";
import type { CatalogAction } from "@/features/policy/types";
import type { WorkflowVersion } from "../types";
import { scopeName } from "./scope-check";

/** Each catalog app as connections name it. */
const GOOGLE_APPS: Record<CatalogAction["app"], GoogleApp> = { Gmail: "gmail", Sheets: "sheets" };

/** What a connection is short of: apps as the catalog names them, scopes by short name. */
export type MissingAccess = { apps: CatalogAction["app"][]; scopes: string[] };

/**
 * The apps the version uses, as the catalog names them: Gmail for the trigger, then each app a
 * catalog action it calls belongs to, each once.
 */
export function requiredApps(version: Pick<WorkflowVersion, "requiredActions">) {
  return appsUsed(version.requiredActions);
}

/**
 * What `granted` lacks for the version: each app it uses that wasn't granted (by app, as the
 * consent screen offers them), and the scopes those apps and the version's actions need. A
 * connection that lacks nothing gives empty lists; no connection lacks everything.
 */
export function missingAccess(
  version: Pick<WorkflowVersion, "requiredActions">,
  granted: { apps: readonly GoogleApp[]; grantedScopes: readonly string[] } | null,
): MissingAccess {
  const apps = granted?.apps ?? [];
  const scopes = granted?.grantedScopes ?? [];
  const missingApps = requiredApps(version).filter((app) => !apps.includes(GOOGLE_APPS[app]));
  const actionScopes = version.requiredActions.flatMap((name) => {
    const action = findAction(name);
    if (action === undefined || action.scopes.some((scope) => scopes.includes(scope))) return [];
    return action.scopes.slice(0, 1);
  });
  const missingScopes = [
    ...missingApps.map((app) => GOOGLE_APP_SCOPES[GOOGLE_APPS[app]]),
    ...actionScopes,
  ].map(scopeName);
  return { apps: missingApps, scopes: [...new Set(missingScopes)] };
}
