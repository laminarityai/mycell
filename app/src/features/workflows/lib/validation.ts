// Save-time validation: the spec schema, the policy engine, then checks against the org's
// setup. Every failing stage's issues come back together in one SpecInvalidError.
import { gmailConnections, listConnections } from "@/features/connections/server";
import type { ConnectionSummary } from "@/features/connections/types";
import { actionSetWith } from "@/features/custom-actions/description";
import { listCustomActions } from "@/features/custom-actions/server";
import type { CustomActionRecord } from "@/features/custom-actions/types";
import type { ActionSet } from "@/features/policy/types";
import type { Spec, SpecIssue } from "@/features/spec/types";
import { issuesAsWritten } from "@/features/spec/upgrade";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { SpecInvalidError } from "@/lib/errors";
import type { SpecCheck, ValidatedSpec } from "../types";
import { checkedByPolicy, requiredActions } from "./policy-check";
import { unconnectedApps } from "./requirements";
import { scopeIssues } from "./scope-check";

export type { ValidatedSpec };

/** What the org-setup checks look at, read once per validation. */
export type OrgSetup = {
  /** The caller's own member connections. */
  ownConnections: ConnectionSummary[];
  orgConnections: ConnectionSummary[];
};

/**
 * One check of a spec that passed the policy engine against the org's setup; each returns its
 * issues and never throws for a bad spec. It gets the working spec, so its issues' paths are
 * where the admin wrote them: the approvals the engine inserts use no actions. `actions` is the
 * company's action set.
 */
export type SetupCheck = (spec: Spec, setup: OrgSetup, actions: ActionSet) => SpecIssue[];

/**
 * Validates `input` for the caller, or throws SpecInvalidError with every issue. The schema
 * and the policy engine run first, against the company's action set `actions`: the setup checks
 * need a spec they can read.
 */
export async function validateWorkflowSpec(
  ctx: Ctx,
  input: unknown,
  actions: ActionSet,
): Promise<ValidatedSpec> {
  const validated = checkedByPolicy(input, actions);
  const setup = await readSetup(ctx);
  const issues = SETUP_CHECKS.flatMap((check) => check(validated.working, setup, actions));
  if (issues.length > 0) throw new SpecInvalidError(issuesAsWritten(input, issues));
  return validated;
}

/**
 * Validates `input` for the caller as saving would, returning every issue instead of throwing
 * them: for the builder's proposals and the editor's live validation. A proposal checks its spec
 * with the custom actions it brings, `newCustomActions`, as if they were stored.
 */
export async function checkWorkflowSpec(
  ctx: Ctx,
  input: unknown,
  newCustomActions: readonly CustomActionRecord[] = [],
): Promise<SpecCheck> {
  requireAdmin(ctx);
  const actions = actionSetWith([...(await listCustomActions(ctx)), ...newCustomActions]);
  try {
    return { ok: true, ...(await validateWorkflowSpec(ctx, input, actions)) };
  } catch (error) {
    if (error instanceof SpecInvalidError) return { ok: false, issues: error.issues };
    throw error;
  }
}

/**
 * The connections a spec could run on: the caller's own member connections for `member`
 * credentials, the org's connections for `org`, narrowed to those that reach Gmail (the
 * trigger's source). Later checks (scopes) look only at these.
 */
export function candidateConnections(spec: Spec, setup: OrgSetup): ConnectionSummary[] {
  return gmailConnections(
    { own: setup.ownConnections, org: setup.orgConnections },
    spec.credentials,
  );
}

/** A spec needs at least one connection of the kind its credentials name. */
const connectionCheck: SetupCheck = (spec, setup) => {
  if (candidateConnections(spec, setup).length > 0) return [];
  return [
    {
      path: ["credentials"],
      message:
        spec.credentials === "member"
          ? "A member-credential workflow needs your own Google connection, allowed Gmail. Connect Google first, or reconnect it to allow Gmail."
          : "An org-credential workflow needs an org Google connection, allowed Gmail. Connect a shared account first, or reconnect it to allow Gmail.",
    },
  ];
};

/** Every action the spec uses needs its scope granted to a connection it could run on. */
const scopeCheck: SetupCheck = (spec, setup, actions) =>
  scopeIssues(spec, candidateConnections(spec, setup), actions);

/**
 * A custom action in a registered app other than Google runs through a connection to that app
 * of the kind the credentials name: the runner's own, or the org's (ADR-0018).
 */
const appConnectionCheck: SetupCheck = (spec, setup, actions) => {
  const member = spec.credentials === "member";
  const connections = member ? setup.ownConnections : setup.orgConnections;
  return unconnectedApps(requiredActions(spec), connections, actions).map((app) => ({
    path: ["credentials"],
    message: member
      ? `This workflow uses ${app}, so it needs your own ${app} connection. Connect ${app} first.`
      : `This workflow uses ${app}, so it needs an org ${app} connection. Connect a shared ${app} account first.`,
  }));
};

const SETUP_CHECKS: SetupCheck[] = [connectionCheck, scopeCheck, appConnectionCheck];

// A Google connection reaches Gmail when it was granted Gmail (ADR-0014).
export function reachesGmail(connection: ConnectionSummary): boolean {
  return connection.apps.includes("gmail");
}

export async function readSetup(ctx: Ctx): Promise<OrgSetup> {
  const listing = await listConnections(ctx);
  return { ownConnections: listing.connections, orgConnections: listing.orgConnections };
}
