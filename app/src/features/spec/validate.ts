import { specSchema, type Spec, type SpecIssue, type SpecValidation, type Step } from "./types";

/**
 * Parses a spec and checks it structurally. Every issue comes back in one list, each naming
 * the path of the field it's about. Pure: no IO, no ctx.
 */
export function validateSpec(input: unknown): SpecValidation {
  const parsed = specSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue): SpecIssue => ({
        path: issue.path.map((key) => (typeof key === "number" ? key : String(key))),
        message: issue.message,
      })),
    };
  }
  const issues = structuralIssues(parsed.data);
  return issues.length === 0 ? { ok: true, spec: parsed.data } : { ok: false, issues };
}

/** Rules that span steps: unique IDs, references only to earlier steps or the trigger. */
function structuralIssues(spec: Spec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const earlier = new Map<string, Step>();
  spec.steps.forEach((step, index) => {
    const at = (...path: (string | number)[]) => ["steps", index, ...path];
    const refersBack = (stepId: string, path: (string | number)[]) => {
      const target = earlier.get(stepId);
      if (target === undefined) {
        issues.push({ path, message: `"${stepId}" isn't a step before this one.` });
      }
      return target;
    };

    if (earlier.has(step.id)) {
      issues.push({ path: at("id"), message: `Step ID "${step.id}" is used twice.` });
    }

    if (step.type === "branch") {
      const target = refersBack(step.when.step, at("when", "step"));
      if (target !== undefined && target.type !== "classify") {
        issues.push({
          path: at("when", "step"),
          message: `A branch needs a classify step, and "${target.id}" is a ${target.type} step.`,
        });
      } else if (target?.type === "classify" && !target.labels.includes(step.when.label)) {
        issues.push({
          path: at("when", "label"),
          message: `"${target.id}" has no label "${step.when.label}".`,
        });
      }
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
    earlier.set(step.id, step);
  });
  return issues;
}

/** A check that could never pass: minP off a classify, requiredFields the extract lacks. */
function checkIssues(step: Step, at: (...path: (string | number)[]) => SpecIssue["path"]) {
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

/** What a draft may read from the trigger: the message, or its whole thread. */
const TRIGGER_CONTEXT = new Set(["trigger.message", "trigger.thread"]);

/** Named in the architecture's example; refused until memory exists (M9). */
const ORG_MEMORY = "org_memory";
