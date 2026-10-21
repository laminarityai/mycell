// The policy engine (invariant 4): a spec's risk comes only from the catalog's fixed levels.
// Pure: no IO, no ctx.
import { z } from "zod";
import { eachStep, mapStepLists } from "@/features/spec/tree";
import type { Spec, SpecIssue, Step } from "@/features/spec/types";
import { SpecInvalidError } from "@/lib/errors";
import { findAction } from "./catalog";
import {
  riskLevelSchema,
  type CatalogAction,
  type InsertedApproval,
  type PolicyResult,
  type RiskLevel,
} from "./types";

const ORDER = riskLevelSchema.options;

/**
 * The highest risk level among the spec's `tool` actions and `draft` outputs. Model steps
 * count as `read`. Any `risk` field in the spec is ignored. Throws SpecInvalidError on actions
 * the catalog doesn't have; `applyPolicy` reports those as issues instead.
 */
export function maxRisk(spec: Spec): RiskLevel {
  let highest: RiskLevel = "read";
  for (const { step, location } of eachStep(spec)) {
    const used = actionOf(step);
    if (used === undefined) continue;
    const action = findAction(used.name);
    if (action === undefined) {
      const path = [...location, used.field];
      throw new SpecInvalidError([{ path, message: `"${used.name}" isn't a catalog action.` }]);
    }
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
  const placed = eachStep(spec);
  const ids = new Set(placed.map(({ step }) => step.id));
  const approved = placed.some(({ step }) => step.type === "approval");
  const withApprovals = mapStepLists(spec, (steps) =>
    steps.flatMap((step): Step[] => {
      if (step.type !== "draft" || approved) return [step];
      const stepId = freeId(`${step.id}-approval`, ids);
      ids.add(stepId);
      inserted.push({ stepId, after: step.id, action: step.output });
      return [step, { id: stepId, type: "approval", channel: "gmail_drafts" }];
    }),
  );

  const result = inserted.length === 0 ? spec : withApprovals;
  return { ok: true, spec: result, maxRisk: maxRisk(result), inserted };
}

/**
 * Unknown actions, actions used where their risk level doesn't allow, and literal inputs the
 * action's input schema refuses.
 */
function actionIssues(spec: Spec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  for (const { step, location } of eachStep(spec)) {
    if (step.type !== "tool" && step.type !== "draft") continue;
    const [field, name] = step.type === "tool" ? ["action", step.action] : ["output", step.output];
    const path = [...location, field];
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
    } else if (step.type === "tool") {
      issues.push(...literalInputIssues(step, location, action));
    }
  }
  return issues;
}

/**
 * Each literal input value the action's schema refuses for its field. A reference is resolved
 * only in a run, so the run checks it then; so do fields the action doesn't name.
 */
function literalInputIssues(
  step: Extract<Step, { type: "tool" }>,
  location: SpecIssue["path"],
  action: CatalogAction,
): SpecIssue[] {
  if (!(action.input instanceof z.ZodObject)) return [];
  const shape = action.input.shape as Record<string, z.ZodType | undefined>;
  return Object.entries(step.input).flatMap(([name, value]) => {
    const field = shape[name];
    if (field === undefined || (typeof value === "object" && value !== null)) return [];
    const parsed = field.safeParse(value);
    if (parsed.success) return [];
    const reason = parsed.error.issues.at(0)?.message ?? "It isn't valid.";
    return [{ path: [...location, "input", name], message: `${name}: ${reason}` }];
  });
}

function freeId(wanted: string, taken: Set<string>): string {
  let id = wanted;
  for (let n = 2; taken.has(id); n++) id = `${wanted}-${String(n)}`;
  return id;
}

// The catalog action a step uses, and the field that names it.
function actionOf(step: Step): { name: string; field: "action" | "output" } | undefined {
  if (step.type === "tool") return { name: step.action, field: "action" };
  if (step.type === "draft") return { name: step.output, field: "output" };
  return undefined;
}
