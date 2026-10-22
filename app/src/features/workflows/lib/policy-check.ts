// The checks of a spec that need nothing but the spec and the company's action set: the spec
// schema and the policy engine. Pure, so the editor runs them in the browser as the admin types
// (live-check.ts), and saving runs them first (validation.ts).
import { applyPolicy } from "@/features/policy/engine";
import type { ActionSet } from "@/features/policy/types";
import { eachStep } from "@/features/spec/tree";
import type { Spec } from "@/features/spec/types";
import { issuesAsWritten } from "@/features/spec/upgrade";
import { validateSpec } from "@/features/spec/validate";
import { SpecInvalidError } from "@/lib/errors";
import type { ValidatedSpec } from "../types";

/**
 * The spec schema and the policy engine on `input`, without the org-setup checks: what a version
 * of it would hold and need, against the company's action set. Throws SpecInvalidError with
 * every issue.
 */
export function checkedByPolicy(input: unknown, actions: ActionSet): ValidatedSpec {
  const parsed = validateSpec(input);
  if (!parsed.ok) throw new SpecInvalidError(parsed.issues);
  // The spec past here is v2; issues about it point where the input wrote the field.
  const policy = applyPolicy(parsed.spec, actions);
  if (!policy.ok) throw new SpecInvalidError(issuesAsWritten(input, policy.issues));
  return {
    working: parsed.spec,
    applied: policy.spec,
    maxRisk: policy.maxRisk,
    inserted: policy.inserted,
    requiredActions: requiredActions(policy.spec),
  };
}

/** The actions the spec names, at any depth, each once, in the order a run reaches them. */
export function requiredActions(spec: Spec): string[] {
  const names = eachStep(spec).flatMap(({ step }) =>
    step.type === "tool" ? [step.action] : step.type === "draft" ? [step.output] : [],
  );
  return [...new Set(names)];
}
