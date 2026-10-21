// Save-time validation: the spec schema, the policy engine, then checks against the org's
// setup. Every failing stage's issues come back together in one SpecInvalidError.
import { gmailConnections, listConnections } from "@/features/connections/server";
import type { ConnectionSummary } from "@/features/connections/types";
import { applyPolicy } from "@/features/policy/engine";
import type { Spec, SpecIssue } from "@/features/spec/types";
import { validateSpec } from "@/features/spec/validate";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { SpecInvalidError } from "@/lib/errors";
import type { SpecCheck, ValidatedSpec } from "../types";
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
 * where the admin wrote them: the approvals the engine inserts use no actions.
 */
export type SetupCheck = (spec: Spec, setup: OrgSetup) => SpecIssue[];

/**
 * Validates `input` for the caller, or throws SpecInvalidError with every issue. The schema
 * and the policy engine run first: the setup checks need a spec they can read.
 */
export async function validateWorkflowSpec(ctx: Ctx, input: unknown): Promise<ValidatedSpec> {
  const parsed = validateSpec(input);
  if (!parsed.ok) throw new SpecInvalidError(parsed.issues);
  const policy = applyPolicy(parsed.spec);
  if (!policy.ok) throw new SpecInvalidError(policy.issues);

  const setup = await readSetup(ctx);
  const issues = SETUP_CHECKS.flatMap((check) => check(parsed.spec, setup));
  if (issues.length > 0) throw new SpecInvalidError(issues);

  return {
    working: parsed.spec,
    applied: policy.spec,
    maxRisk: policy.maxRisk,
    inserted: policy.inserted,
    requiredActions: requiredActions(policy.spec),
  };
}

/**
 * Validates `input` for the caller as saving would, returning every issue instead of throwing
 * them: for the builder's proposals and the editor's live validation.
 */
export async function checkWorkflowSpec(ctx: Ctx, input: unknown): Promise<SpecCheck> {
  requireAdmin(ctx);
  try {
    return { ok: true, ...(await validateWorkflowSpec(ctx, input)) };
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
const scopeCheck: SetupCheck = (spec, setup) =>
  scopeIssues(spec, candidateConnections(spec, setup));

const SETUP_CHECKS: SetupCheck[] = [connectionCheck, scopeCheck];

// A Google connection reaches Gmail when it was granted Gmail (ADR-0014).
export function reachesGmail(connection: ConnectionSummary): boolean {
  return connection.apps.includes("gmail");
}

export async function readSetup(ctx: Ctx): Promise<OrgSetup> {
  const listing = await listConnections(ctx);
  return { ownConnections: listing.connections, orgConnections: listing.orgConnections };
}

function requiredActions(spec: Spec): string[] {
  const names = spec.steps.flatMap((step) =>
    step.type === "tool" ? [step.action] : step.type === "draft" ? [step.output] : [],
  );
  return [...new Set(names)];
}
