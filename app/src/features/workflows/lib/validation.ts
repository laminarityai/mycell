// Save-time validation: the spec schema, the policy engine, then checks against the org's
// setup. Every failing stage's issues come back together in one SpecInvalidError.
import { listConnections } from "@/features/connections/server";
import type { ConnectionSummary } from "@/features/connections/types";
import { applyPolicy } from "@/features/policy/engine";
import type { InsertedApproval, RiskLevel } from "@/features/policy/types";
import type { Spec, SpecIssue } from "@/features/spec/types";
import { validateSpec } from "@/features/spec/validate";
import type { Ctx } from "@/lib/ctx";
import { SpecInvalidError } from "@/lib/errors";

/** A spec that passed every stage, with what the policy engine made of it. */
export type ValidatedSpec = {
  /** The working spec, as parsed: before the policy engine inserted anything. */
  working: Spec;
  /** The spec a version would hold: after `applyPolicy`. */
  applied: Spec;
  maxRisk: RiskLevel;
  inserted: InsertedApproval[];
  requiredActions: string[];
};

/** What the org-setup checks look at, read once per validation. */
export type OrgSetup = {
  /** The caller's own member connections. */
  ownConnections: ConnectionSummary[];
  orgConnections: ConnectionSummary[];
};

/**
 * One check of a policy-applied spec against the org's setup. Scope checks (#38) and later
 * ones join `SETUP_CHECKS`; each returns its issues and never throws for a bad spec.
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
  const issues = SETUP_CHECKS.flatMap((check) => check(policy.spec, setup));
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
 * The connections a spec could run on: the caller's own member connections for `member`
 * credentials, the org's connections for `org`, narrowed to those that reach Gmail (the
 * trigger's source). Later checks (scopes) look only at these.
 */
export function candidateConnections(spec: Spec, setup: OrgSetup): ConnectionSummary[] {
  const pool = spec.credentials === "member" ? setup.ownConnections : setup.orgConnections;
  return pool.filter(reachesGmail);
}

/** A spec needs at least one connection of the kind its credentials name. */
const connectionCheck: SetupCheck = (spec, setup) => {
  if (candidateConnections(spec, setup).length > 0) return [];
  return [
    {
      path: ["credentials"],
      message:
        spec.credentials === "member"
          ? "A member-credential workflow needs your own Gmail connection. Connect Gmail first."
          : "An org-credential workflow needs an org Gmail connection. Connect a shared inbox first.",
    },
  ];
};

const SETUP_CHECKS: SetupCheck[] = [connectionCheck];

// One Google connection reaches every app from #62 on; until then, Gmail is its own source.
function reachesGmail(connection: ConnectionSummary): boolean {
  return connection.source === "gmail";
}

async function readSetup(ctx: Ctx): Promise<OrgSetup> {
  const listing = await listConnections(ctx);
  return { ownConnections: listing.connections, orgConnections: listing.orgConnections };
}

function requiredActions(spec: Spec): string[] {
  const names = spec.steps.flatMap((step) =>
    step.type === "tool" ? [step.action] : step.type === "draft" ? [step.output] : [],
  );
  return [...new Set(names)];
}
