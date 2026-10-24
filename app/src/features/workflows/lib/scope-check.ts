// The scope check: every action a spec uses needs one of its scopes granted to the connection
// the spec would run on. A connection whose owner unticked the action's Google app on the consent
// screen is reconnected to allow that app; one made before write access was asked for (ADR-0011)
// holds only gmail.readonly, and its owner reconnects it to grant write access.
import { googleAppOf } from "@/features/connections/registered-apps";
import type { ConnectionSummary, GoogleApp } from "@/features/connections/types";
import { scopesOf } from "@/features/policy/action-set";
import type { Action, ActionSet, ConnectionApp } from "@/features/policy/types";
import { eachStep } from "@/features/spec/tree";
import type { Spec, SpecIssue } from "@/features/spec/types";
import { GOOGLE_APP_NAMES, GOOGLE_SCOPE_PREFIX as SCOPE_PREFIX } from "@/lib/google";

/** Each catalog app as connections name it. */
const CATALOG_APPS: Record<ConnectionApp, GoogleApp> = {
  Gmail: "gmail",
  Sheets: "sheets",
  Tasks: "tasks",
};

/**
 * An action the spec uses, where it names it, the scopes any one of which lets it run, and the
 * Google app it acts in, if any.
 */
type ActionUse = {
  path: (string | number)[];
  action: string;
  scopes: readonly string[];
  writes: boolean;
  app: GoogleApp | undefined;
};

/**
 * The issues of running `spec` on one of `connections`: none when some connection was granted a
 * scope for every action the spec uses, or else each action the closest one lacks, naming its
 * scope. No connections at all is the connection check's issue, not this one's. `actions` is
 * the org's action set.
 */
export function scopeIssues(
  spec: Spec,
  connections: ConnectionSummary[],
  actions: ActionSet,
): SpecIssue[] {
  const uses = actionUses(spec, actions);
  const lacking = connections
    .map((connection) => ({ connection, missing: uses.filter((use) => !allows(connection, use)) }))
    .sort((a, b) => a.missing.length - b.missing.length)
    .at(0);
  if (lacking === undefined) return [];
  const { accountEmail, apps } = lacking.connection;
  return lacking.missing.map((use) => {
    // An app unticked on the consent screen is named, as the reconnect offers it.
    if (use.app !== undefined && !apps.includes(use.app)) {
      const app = GOOGLE_APP_NAMES[use.app];
      return {
        path: use.path,
        message: `${use.action} needs ${app}, which ${accountEmail} wasn't granted. Reconnect it to allow ${app}.`,
      };
    }
    return {
      path: use.path,
      message: `${use.action} needs the ${scopeName(use.scopes[0] ?? "")} scope, which ${accountEmail} wasn't granted. Reconnect it to grant ${use.writes ? "write access" : "it"}.`,
    };
  });
}

/** The Google app an action acts in: a catalog action's, or a custom Google action's by its path. */
export function googleAppsOf(action: Action | undefined): GoogleApp[] {
  if (action?.kind === "catalog") {
    return action.integration === "google" ? [CATALOG_APPS[action.app]] : [];
  }
  if (action?.kind !== "custom" || action.registeredApp !== "google") return [];
  const app = googleAppOf(action.request.path);
  return app === undefined ? [] : [app];
}

function actionUses(spec: Spec, actions: ActionSet): ActionUse[] {
  return eachStep(spec).flatMap(({ step, location }): ActionUse[] => {
    const named =
      step.type === "tool"
        ? { field: "action", action: step.action }
        : step.type === "draft"
          ? { field: "output", action: step.output }
          : undefined;
    const action = named === undefined ? undefined : actions.find(named.action);
    if (named === undefined || action === undefined) return [];
    // An action on what Mycel holds needs no scope, and a custom action in another app runs
    // through a connection to that app, not this one (requirements.ts); a custom Google action
    // names its Google app's.
    return scopesOf(action).map((scopes) => ({
      path: [...location, named.field],
      action: action.name,
      scopes,
      writes: action.risk !== "read",
      app: googleAppsOf(action).at(0),
    }));
  });
}

function allows(connection: ConnectionSummary, use: ActionUse): boolean {
  return use.scopes.some((scope) => connection.grantedScopes.includes(scope));
}

// gmail.modify rather than its full URL, as Google's consent screen and docs name it.
export function scopeName(scope: string): string {
  return scope.startsWith(SCOPE_PREFIX) ? scope.slice(SCOPE_PREFIX.length) : scope;
}
