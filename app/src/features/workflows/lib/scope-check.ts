// The scope check: every catalog action a spec uses needs one of its scopes granted to the
// connection the spec would run on. A connection made before write access was asked for
// (ADR-0011) holds only gmail.readonly, and its owner reconnects it to grant write access.
import type { ConnectionSummary } from "@/features/connections/types";
import { findAction } from "@/features/policy/catalog";
import type { Spec, SpecIssue } from "@/features/spec/types";

const SCOPE_PREFIX = "https://www.googleapis.com/auth/";

/** An action the spec uses, where it names it, and the scopes any one of which lets it run. */
type ActionUse = {
  path: (string | number)[];
  action: string;
  scopes: readonly string[];
  writes: boolean;
};

/**
 * The issues of running `spec` on one of `connections`: none when some connection was granted a
 * scope for every action the spec uses, or else each action the closest one lacks, naming its
 * scope. No connections at all is the connection check's issue, not this one's.
 */
export function scopeIssues(spec: Spec, connections: ConnectionSummary[]): SpecIssue[] {
  const uses = actionUses(spec);
  const lacking = connections
    .map((connection) => ({ connection, missing: uses.filter((use) => !allows(connection, use)) }))
    .sort((a, b) => a.missing.length - b.missing.length)
    .at(0);
  if (lacking === undefined) return [];
  return lacking.missing.map((use) => ({
    path: use.path,
    message: `${use.action} needs the ${scopeName(use.scopes[0] ?? "")} scope, which ${lacking.connection.accountEmail} wasn't granted. Reconnect it to grant ${use.writes ? "write access" : "it"}.`,
  }));
}

function actionUses(spec: Spec): ActionUse[] {
  return spec.steps.flatMap((step, index): ActionUse[] => {
    const named =
      step.type === "tool"
        ? { field: "action", action: step.action }
        : step.type === "draft"
          ? { field: "output", action: step.output }
          : undefined;
    const action = named === undefined ? undefined : findAction(named.action);
    if (named === undefined || action === undefined) return [];
    return [
      {
        path: ["steps", index, named.field],
        action: action.name,
        scopes: action.scopes,
        writes: action.risk !== "read",
      },
    ];
  });
}

function allows(connection: ConnectionSummary, use: ActionUse): boolean {
  return use.scopes.some((scope) => connection.grantedScopes.includes(scope));
}

// gmail.modify rather than its full URL, as Google's consent screen and docs name it.
function scopeName(scope: string): string {
  return scope.startsWith(SCOPE_PREFIX) ? scope.slice(SCOPE_PREFIX.length) : scope;
}
