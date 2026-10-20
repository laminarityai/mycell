// The policy engine (invariant 4): a spec's risk comes only from the catalog's fixed levels.
// Pure: no IO, no ctx.
import type { Spec, SpecIssue, Step } from "@/features/spec/types";
import { findAction } from "./catalog";
import { riskLevelSchema, type InsertedApproval, type PolicyResult, type RiskLevel } from "./types";

const ORDER = riskLevelSchema.options;

/**
 * The highest risk level among the spec's `tool` actions and `draft` outputs. Model steps
 * count as `read`. Any `risk` field in the spec is ignored. Throws on an action the catalog
 * doesn't have; `applyPolicy` reports those as issues instead.
 */
export function maxRisk(spec: Spec): RiskLevel {
  let highest: RiskLevel = "read";
  for (const name of actionsOf(spec)) {
    const action = findAction(name);
    if (action === undefined) throw new Error(`"${name}" isn't a catalog action.`);
    if (ORDER.indexOf(action.risk) > ORDER.indexOf(highest)) highest = action.risk;
  }
  return highest;
}

/**
 * Checks the spec's actions against the catalog and makes sure every `external_send` action
 * waits for a person: a `draft` output needs an `approval` step before or after it, and one is
 * inserted directly after the draft when there's none. Returns the spec with what it
 * inserted, or every issue at once.
 */
export function applyPolicy(spec: Spec): PolicyResult {
  const issues = actionIssues(spec);
  if (issues.length > 0) return { ok: false, issues };

  const inserted: InsertedApproval[] = [];
  const steps: Step[] = [];
  const ids = new Set(spec.steps.map((step) => step.id));
  spec.steps.forEach((step, index) => {
    steps.push(step);
    if (step.type !== "draft") return;
    const approved = spec.steps.some((other, i) => i !== index && other.type === "approval");
    if (approved) return;
    const stepId = freeId(`${step.id}-approval`, ids);
    ids.add(stepId);
    steps.push({ id: stepId, type: "approval", channel: "gmail_drafts" });
    inserted.push({ stepId, after: step.id, action: step.output });
  });

  const result = inserted.length === 0 ? spec : { ...spec, steps };
  return { ok: true, spec: result, maxRisk: maxRisk(result), inserted };
}

/** Unknown actions, and actions used where their risk level doesn't allow. */
function actionIssues(spec: Spec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  spec.steps.forEach((step, index) => {
    if (step.type !== "tool" && step.type !== "draft") return;
    const [field, name] = step.type === "tool" ? ["action", step.action] : ["output", step.output];
    const path = ["steps", index, field];
    const action = findAction(name);
    if (action === undefined) {
      issues.push({ path, message: `"${name}" isn't a catalog action.` });
    } else if (step.type === "tool" && action.risk === "external_send") {
      issues.push({
        path,
        message: `"${name}" sends outside the company, so it can only be a draft step's output.`,
      });
    } else if (step.type === "draft" && action.risk !== "external_send") {
      issues.push({ path, message: `"${name}" doesn't create a draft; use it in a tool step.` });
    }
  });
  return issues;
}

function freeId(wanted: string, taken: Set<string>): string {
  let id = wanted;
  for (let n = 2; taken.has(id); n++) id = `${wanted}-${String(n)}`;
  return id;
}

function actionsOf(spec: Spec): string[] {
  return spec.steps.flatMap((step) =>
    step.type === "tool" ? [step.action] : step.type === "draft" ? [step.output] : [],
  );
}
