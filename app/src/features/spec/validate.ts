import type { z } from "zod";
import { eachStep } from "./tree";
import {
  specSchema,
  type BranchStep,
  type Spec,
  type SpecIssue,
  type SpecValidation,
  type Step,
} from "./types";
import { issuesAsWritten, upgradeSpec } from "./upgrade";
import { specV1Schema } from "./v1";

type At = (...path: (string | number)[]) => SpecIssue["path"];

/**
 * Parses a spec and checks it structurally. Every issue comes back in one list, each naming
 * the path of the field it's about. A v1 spec is accepted and comes back upgraded, its issues
 * named where it wrote them. Pure: no IO, no ctx.
 */
export function validateSpec(input: unknown): SpecValidation {
  const v1 = isObject(input) && input.specVersion === 1;
  const parsed = v1 ? specV1Schema.safeParse(input) : specSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: schemaIssues(parsed.error) };
  const spec = upgradeSpec(parsed.data);
  const issues = structuralIssues(spec);
  return issues.length === 0
    ? { ok: true, spec }
    : { ok: false, issues: issuesAsWritten(input, issues) };
}

function schemaIssues(error: z.ZodError): SpecIssue[] {
  return error.issues.map((issue): SpecIssue => ({
    path: issue.path.map((key) => (typeof key === "number" ? key : String(key))),
    message: issue.message,
  }));
}

/** Rules that span steps: unique IDs, references only to steps above or the trigger. */
function structuralIssues(spec: Spec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const seen = new Set<string>();
  for (const { step, location, above } of eachStep(spec)) {
    const at: At = (...path) => [...location, ...path];
    const refersBack = (stepId: string, path: (string | number)[]) => {
      const target = above.findLast((candidate) => candidate.id === stepId);
      if (target === undefined) {
        issues.push({ path, message: `"${stepId}" isn't a step before this one.` });
      }
      return target;
    };

    if (seen.has(step.id)) {
      issues.push({ path: at("id"), message: `Step ID "${step.id}" is used twice.` });
    }
    seen.add(step.id);

    if (step.type === "branch") {
      issues.push(...branchIssues(step, at, refersBack, seen));
    }
    if (step.type === "draft") {
      step.context.forEach((entry, i) => {
        if (entry === ORG_MEMORY) {
          issues.push({
            path: at("context", i),
            message: "Org memory isn't available as draft context yet.",
          });
        } else if (!TRIGGER_CONTEXT.has(entry)) {
          refersBack(entry, at("context", i));
        }
      });
    }
    if (step.type === "tool") {
      for (const [name, value] of Object.entries(step.input)) {
        const values = Array.isArray(value) ? value : [value];
        values.forEach((item, i) => {
          if (item === null || typeof item !== "object") return;
          const [source = ""] = item.from.split(".");
          const path = Array.isArray(value)
            ? at("input", name, i, "from")
            : at("input", name, "from");
          if (source !== "trigger") refersBack(source, path);
        });
      }
    }

    issues.push(...checkIssues(step, at));
  }
  return issues;
}

/**
 * A branch's paths: IDs unique with the steps', and each classify check on a classify step
 * above the branch that has the label. A branch runs only first match on one path, testing
 * classify answers, until the tickets that add the rest of ADR-0015 land.
 */
function branchIssues(
  step: BranchStep,
  at: At,
  refersBack: (stepId: string, path: SpecIssue["path"]) => Step | undefined,
  seen: Set<string>,
): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const pathIds: [string, SpecIssue["path"]][] = [
    ...step.paths.map((path, p): [string, SpecIssue["path"]] => [path.id, at("paths", p, "id")]),
    [step.otherwise.id, at("otherwise", "id")],
  ];
  for (const [id, path] of pathIds) {
    if (seen.has(id)) issues.push({ path, message: `The ID "${id}" is used twice.` });
    seen.add(id);
  }
  if (step.mode === "every") {
    issues.push({ path: at("mode"), message: "Every match isn't available yet; use first." });
  }
  if (step.paths.length > 1) {
    issues.push({ path: at("paths", 1), message: "A branch can have only one path for now." });
  }
  step.paths.forEach((path, p) => {
    path.condition.checks.forEach((check, c) => {
      const checkAt = (...field: string[]) => at("paths", p, "condition", "checks", c, ...field);
      if (!("classify" in check)) {
        issues.push({ path: checkAt(), message: "Only a classify answer can be checked for now." });
        return;
      }
      const target = refersBack(check.classify, checkAt("classify"));
      if (target !== undefined && target.type !== "classify") {
        issues.push({
          path: checkAt("classify"),
          message: `A branch needs a classify step, and "${target.id}" is a ${target.type} step.`,
        });
      } else if (target?.type === "classify" && !target.labels.includes(check.is)) {
        issues.push({
          path: checkAt("is"),
          message: `"${target.id}" has no label "${check.is}".`,
        });
      }
    });
  });
  return issues;
}

/** A check that could never pass: minP off a classify, requiredFields the extract lacks. */
function checkIssues(step: Step, at: At) {
  const issues: SpecIssue[] = [];
  if (step.checks?.minP !== undefined && step.type !== "classify") {
    issues.push({ path: at("checks", "minP"), message: "Only a classify step has a p to check." });
  }
  const required = step.checks?.requiredFields;
  if (required === undefined) return issues;
  if (step.type !== "extract") {
    issues.push({
      path: at("checks", "requiredFields"),
      message: "Only an extract step has fields to require.",
    });
    return issues;
  }
  required.forEach((name, i) => {
    if (!(name in step.fields)) {
      issues.push({
        path: at("checks", "requiredFields", i),
        message: `"${step.id}" has no field "${name}".`,
      });
    }
  });
  return issues;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What a draft may read from the trigger: the message, or its whole thread. */
const TRIGGER_CONTEXT = new Set(["trigger.message", "trigger.thread"]);

/** Named in the architecture's example; refused until memory exists (M9). */
const ORG_MEMORY = "org_memory";
