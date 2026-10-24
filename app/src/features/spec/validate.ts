import type { z } from "zod";
import { branchIssues } from "./branch-issues";
import { referencesIn } from "./input-values";
import { eachStep } from "./tree";
import { triggers } from "./triggers";
import {
  MAX_BRANCH_DEPTH,
  specSchema,
  type Spec,
  type SpecIssue,
  type SpecValidation,
  type Step,
} from "./types";
import { issuesAsWritten, upgradeSpec } from "./upgrade";
import { specV1Schema } from "./v1";
import { isRecord } from "@/lib/utils";

type At = (...path: (string | number)[]) => SpecIssue["path"];

/**
 * Parses a spec and checks it structurally. Every issue comes back in one list, each naming
 * the path of the field it's about. A v1 spec is accepted and comes back upgraded, its issues
 * named where it wrote them. Pure: no IO, no ctx.
 */
export function validateSpec(input: unknown): SpecValidation {
  const v1 = isRecord(input) && input.specVersion === 1;
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

/**
 * Rules that span steps: unique IDs; references only to the trigger or to steps above on the
 * step's own path, never a sibling path's; a branch last in its list; branches nested at most
 * three deep.
 */
function structuralIssues(spec: Spec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const seen = new Set<string>();
  const trigger = triggers[spec.trigger.type];
  for (const { step, location, above } of eachStep(spec)) {
    const at: At = (...path) => [...location, ...path];
    const refersBack = (stepId: string, path: (string | number)[]) => {
      const target = above.findLast((candidate) => candidate.id === stepId);
      if (target === undefined) {
        issues.push({ path, message: `"${stepId}" isn't above this step on its path.` });
      }
      return target;
    };

    if (seen.has(step.id)) {
      issues.push({ path: at("id"), message: `Step ID "${step.id}" is used twice.` });
    }
    seen.add(step.id);

    if (step.type === "branch") {
      const declared = { trigger: trigger.facts };
      issues.push(...branchIssues(step, at, above, refersBack, seen, declared));
      const depth = above.filter((candidate) => candidate.type === "branch").length + 1;
      if (depth > MAX_BRANCH_DEPTH) {
        const message = `Branches nest at most ${String(MAX_BRANCH_DEPTH)} deep, and this one is ${String(depth)} deep.`;
        issues.push({ path: location, message });
      }
    }
    // The step just above one that isn't first in its list is the one before it in that list.
    if (location.at(-1) !== 0 && above.at(-1)?.type === "branch") {
      issues.push({
        path: location,
        message: "Nothing can follow a branch, since its paths never join: move this onto them.",
      });
    }
    if ((step.type === "draft" || step.type === "escalate") && !trigger.repliable) {
      issues.push({
        path: location,
        message:
          step.type === "draft"
            ? `A draft replies to the Gmail message that started the run, and a run on a new ${trigger.item} has none to reply to.`
            : `An escalation hands a person the Gmail message that started the run, and a run on a new ${trigger.item} has none.`,
      });
    }
    if (step.type === "draft") {
      step.context.forEach((entry, i) => {
        if (entry === ORG_MEMORY) {
          issues.push({
            path: at("context", i),
            message: "Org memory isn't available as draft context yet.",
          });
        } else if (entry.startsWith("trigger.")) {
          if (!trigger.context.includes(entry)) {
            issues.push({ path: at("context", i), message: triggerMiss(entry, trigger.context) });
          }
        } else {
          refersBack(entry, at("context", i));
        }
      });
    }
    if (step.type === "tool") {
      for (const [name, value] of Object.entries(step.input)) {
        for (const { reference, path: below } of referencesIn(value)) {
          const [source = ""] = reference.from.split(".");
          const path = at("input", name, ...below, "from");
          if (source !== "trigger") {
            refersBack(source, path);
          } else if (!trigger.fields.some((field) => reference.from === `trigger.${field}`)) {
            const fields = trigger.fields.map((field) => `trigger.${field}`);
            issues.push({ path, message: triggerMiss(reference.from, fields) });
          }
        }
      }
    }

    issues.push(...checkIssues(step, at));
  }
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

/** The issue of reading what the trigger doesn't offer, naming what it does. */
function triggerMiss(from: string, offered: readonly string[]): string {
  return offered.length === 0
    ? `The trigger offers nothing to read as ${from}.`
    : `The trigger offers ${offered.join(" and ")}, not ${from}.`;
}

/** Named in the architecture's example; refused until memory exists (M9). */
const ORG_MEMORY = "org_memory";
