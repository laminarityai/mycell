// What a workflow version needs from the Google connection it runs on: the apps it uses
// (ADR-0014) and the scope of each action it calls there, catalog or custom; and, for each custom
// action in a registered app other than Google, a connection to that app (ADR-0018). All come
// from the org's action set, never from a model.
import { googleAppOf, REGISTERED_APPS } from "@/features/connections/registered-apps";
import { GOOGLE_APP_NAMES } from "@/lib/google";
import {
  GOOGLE_APP_SCOPES,
  registeredAppIdSchema,
  type ConnectionSummary,
  type GoogleApp,
} from "@/features/connections/types";
import { appsUsed, scopesOf } from "@/features/policy/action-set";
import type { Action, ActionSet, ConnectionApp } from "@/features/policy/types";
import { triggers } from "@/features/spec/triggers";
import type { Spec } from "@/features/spec/types";
import type { WorkflowVersion } from "../types";
import { scopeName } from "./scope-check";

/** Each catalog app as connections name it. */
const CATALOG_APPS: Record<ConnectionApp, GoogleApp> = {
  Gmail: "gmail",
  Sheets: "sheets",
  Docs: "docs",
};

/** What a connection is short of: Google apps as the UI names them, scopes by short name. */
export type MissingAccess = { apps: string[]; scopes: string[] };

/** What a version's requirements are read from: the actions it calls, and its trigger. */
type Needs = Pick<WorkflowVersion, "requiredActions"> & { spec: Pick<Spec, "trigger"> };

/**
 * The apps the version uses, as admins name them: its trigger's (Gmail, or Calendar), then each
 * app an action it calls belongs to, each once, from the org's action set.
 */
export function requiredApps(version: Needs, actions: ActionSet) {
  return appsUsed(version.requiredActions, actions, version.spec.trigger.type);
}

/**
 * What `granted` lacks for the version: each Google app it uses that wasn't granted (by app, as
 * the consent screen offers them: the trigger's, each catalog action's, and each custom
 * Google action's, by its path), and the scopes those apps and the version's actions need. A
 * connection that lacks nothing gives empty lists; no connection lacks everything.
 */
export function missingAccess(
  version: Needs,
  granted: { apps: readonly GoogleApp[]; grantedScopes: readonly string[] } | null,
  actions: ActionSet,
): MissingAccess {
  const apps = granted?.apps ?? [];
  const scopes = granted?.grantedScopes ?? [];
  const used = version.requiredActions.flatMap((name) => googleAppsOf(actions.find(name)));
  const trigger = triggers[version.spec.trigger.type].googleApp;
  const missingApps = [...new Set<GoogleApp>([trigger, ...used])].filter(
    (app) => !apps.includes(app),
  );
  const actionScopes = version.requiredActions.flatMap((name) => {
    const action = actions.find(name);
    if (action === undefined) return [];
    return scopesOf(action).flatMap((anyOf) =>
      anyOf.some((scope) => scopes.includes(scope)) ? [] : anyOf.slice(0, 1),
    );
  });
  const missingScopes = [...missingApps.map((app) => GOOGLE_APP_SCOPES[app]), ...actionScopes].map(
    scopeName,
  );
  return {
    apps: missingApps.map((app) => GOOGLE_APP_NAMES[app]),
    scopes: [...new Set(missingScopes)],
  };
}

// The Google app an action acts in: a catalog action's, or a custom Google action's by its path.
function googleAppsOf(action: Action | undefined): GoogleApp[] {
  if (action?.kind === "catalog") {
    return action.integration === "google" ? [CATALOG_APPS[action.app]] : [];
  }
  if (action?.kind !== "custom" || action.registeredApp !== "google") return [];
  const app = googleAppOf(action.request.path);
  return app === undefined ? [] : [app];
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
