// What a workflow version needs from the Google connection it runs on: the apps it uses
// (ADR-0014) and the scope of each catalog action it calls; and, for each custom action in a
// registered app other than Google, a connection to that app (ADR-0018). All come from the
// company's action set, never from a model.
import { REGISTERED_APPS } from "@/features/connections/registered-apps";
import {
  GOOGLE_APP_SCOPES,
  registeredAppIdSchema,
  type ConnectionSummary,
  type GoogleApp,
} from "@/features/connections/types";
import { appsUsed } from "@/features/policy/action-set";
import type { ActionSet, CatalogAction } from "@/features/policy/types";
import type { WorkflowVersion } from "../types";
import { scopeName } from "./scope-check";

/** Each catalog app as connections name it. */
const GOOGLE_APPS: Record<CatalogAction["app"], GoogleApp> = { Gmail: "gmail", Sheets: "sheets" };

/** What a connection is short of: apps as the catalog names them, scopes by short name. */
export type MissingAccess = { apps: string[]; scopes: string[] };

/**
 * The apps the version uses, as admins name them: Gmail for the trigger, then each app an
 * action it calls belongs to, each once, from the company's action set.
 */
export function requiredApps(
  version: Pick<WorkflowVersion, "requiredActions">,
  actions: ActionSet,
) {
  return appsUsed(version.requiredActions, actions);
}

/**
 * What `granted` lacks for the version: each Google app it uses that wasn't granted (by app, as
 * the consent screen offers them), and the scopes those apps and the version's catalog actions
 * need. A connection that lacks nothing gives empty lists; no connection lacks everything.
 */
export function missingAccess(
  version: Pick<WorkflowVersion, "requiredActions">,
  granted: { apps: readonly GoogleApp[]; grantedScopes: readonly string[] } | null,
  actions: ActionSet,
): MissingAccess {
  const apps = granted?.apps ?? [];
  const scopes = granted?.grantedScopes ?? [];
  const googleApps = version.requiredActions.flatMap((name) => {
    const action = actions.find(name);
    return action?.kind === "catalog" ? [action.app] : [];
  });
  const missingApps = [...new Set<CatalogAction["app"]>(["Gmail", ...googleApps])].filter(
    (app) => !apps.includes(GOOGLE_APPS[app]),
  );
  const actionScopes = version.requiredActions.flatMap((name) => {
    const action = actions.find(name);
    if (action?.kind !== "catalog" || action.scopes.some((scope) => scopes.includes(scope))) {
      return [];
    }
    return action.scopes.slice(0, 1);
  });
  const missingScopes = [
    ...missingApps.map((app) => GOOGLE_APP_SCOPES[GOOGLE_APPS[app]]),
    ...actionScopes,
  ].map(scopeName);
  return { apps: missingApps, scopes: [...new Set(missingScopes)] };
}

/**
 * The registered apps other than Google that the actions named call and none of `connections`
 * reaches, as admins name them: a custom action in an app runs through a connection to it, its
 * runner's own or the org's (ADR-0018).
 */
export function unconnectedApps(
  actionNames: readonly string[],
  connections: readonly Pick<ConnectionSummary, "source">[],
  actions: ActionSet,
): string[] {
  const needed = actionNames.flatMap((name) => {
    const action = actions.find(name);
    const app = registeredAppIdSchema.safeParse(action?.kind === "custom" && action.registeredApp);
    return app.success && app.data !== "google" ? [app.data] : [];
  });
  return [...new Set(needed)]
    .filter((app) => !connections.some((connection) => connection.source === app))
    .map((app) => REGISTERED_APPS[app].name);
}
