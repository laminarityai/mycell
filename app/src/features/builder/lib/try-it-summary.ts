// A try-it result as the conversation keeps it, for the agent to react to: one line per step
// saying what it did, in words built from the spec's own literals (labels, step IDs, ranges)
// and counts only, worded in builder/prompts/try-it.prompt.yml. No message content, draft text,
// row value or extracted value reaches it (invariant 8): those stay on the admin's page. A tool
// input the spec fills from a reference is named by its reference, never by the value it
// resolved to, which may come from the email.
import { checkWords } from "@/features/policy/condition-fields";
import type { ActionSet } from "@/features/policy/types";
import type { BranchPath, DryRunResult, DryRunStep } from "@/features/runtime/types";
import { describeCheck } from "@/features/spec/conditions";
import { isReference } from "@/features/spec/input-values";
import { findStep } from "@/features/spec/tree";
import type { Spec } from "@/features/spec/types";
import { joinPrompts, type PromptText } from "@/lib/prompts";
import type { TryItSummary } from "../types";
import { isRecord } from "@/lib/utils";
import { tryItPrompts } from "./prompts";

const ENDINGS: Record<DryRunResult["ended"], PromptText> = {
  succeeded: tryItPrompts.succeeded(),
  skipped: tryItPrompts.skipped(),
  escalated: tryItPrompts.escalated(),
  failed: tryItPrompts.failed(),
  partly_failed: tryItPrompts.partlyFailed(),
};

/** Summarizes a dry run of `spec`, whose actions are in the company's action set `actions`. */
export function summarizeTryIt(result: DryRunResult, spec: Spec, actions: ActionSet): TryItSummary {
  return {
    lines: [
      ...result.steps.flatMap((step) => [lineOf(step, spec), ...pathLines(step, spec, actions)]),
      ENDINGS[result.ended],
    ],
    costUsd: result.costUsd,
  };
}

function lineOf(dryRunStep: DryRunStep, spec: Spec): PromptText {
  const step = tryItPrompts.step({ id: dryRunStep.stepId, type: dryRunStep.type });
  const { error, effect, output } = dryRunStep;
  if (error !== null) {
    return tryItPrompts.stepFailed({ step, code: error.code, message: error.message });
  }
  const input = (field: string) => specInput(spec, dryRunStep.stepId, field);
  switch (effect?.kind) {
    case "review":
      return dryRunStep.insertedByPolicy
        ? tryItPrompts.wouldReviewByPolicy({ step })
        : tryItPrompts.wouldReview({ step });
    case "draft":
      return tryItPrompts.drafted({ step });
    case "label":
      return tryItPrompts.wouldLabel({ step, label: input("label") });
    case "row":
      return tryItPrompts.wouldAppendRow({ step, range: input("range") });
    case "suggestions":
      return tryItPrompts.wouldSuggestEdits({
        step,
        count: String(effect.requests.length),
        document: input("documentId"),
      });
    case "task":
      return tryItPrompts.wouldAddTask({ step });
    case "task_update":
      return tryItPrompts.wouldUpdateTask({ step, task: input("taskId") });
    case "rows_read":
      return tryItPrompts.readRows({
        step,
        count: String(effect.rows.length),
        range: input("range"),
      });
    case undefined:
      break;
  }
  if (dryRunStep.type === "classify" && isRecord(output)) {
    return tryItPrompts.chose({
      step,
      label: JSON.stringify(output.label),
      p: JSON.stringify(output.p),
    });
  }
  if (dryRunStep.type === "branch" && isRecord(output)) {
    const branch = findStep(spec, dryRunStep.stepId);
    const taken = Array.isArray(output.taken) ? output.taken : [];
    const paths = branch?.type === "branch" ? branch.paths.filter((p) => taken.includes(p.id)) : [];
    if (paths.length === 0) return tryItPrompts.tookOtherwise({ step });
    return tryItPrompts.wentOn({
      step,
      paths: paths.map((path) => JSON.stringify(path.name)).join(", "),
    });
  }
  if (dryRunStep.type === "extract" && isRecord(output)) {
    const filled = Object.entries(output).filter(([, value]) => value !== null && value !== "");
    return filled.length === 0
      ? tryItPrompts.filledNone({ step })
      : tryItPrompts.filled({ step, fields: filled.map(([field]) => field).join(", ") });
  }
  return tryItPrompts.done({ step });
}

const PATH_WORDS: Record<BranchPath["status"], PromptText> = {
  taken: tryItPrompts.pathTaken(),
  not_taken: tryItPrompts.pathNotTaken(),
  not_checked: tryItPrompts.pathNotChecked(),
  not_needed: tryItPrompts.pathNotNeeded(),
};

/**
 * A line per path out of a branch, naming the path and each check as the spec writes them, in
 * the words the condition editor labels what it tests with,
 * with whether it passed: never its reason, which may quote the value it tested. The branch's
 * own line already says whether it took the otherwise path.
 */
function pathLines(step: DryRunStep, spec: Spec, actions: ActionSet): PromptText[] {
  const branch = findStep(spec, step.stepId);
  if (branch?.type !== "branch" || step.paths === undefined) return [];
  const words = checkWords(spec, actions);
  return step.paths.flatMap((result) => {
    const path = branch.paths.find((candidate) => candidate.id === result.id);
    if (path === undefined) return [];
    const checks = path.condition.checks.flatMap((check, index) => {
      const passed = result.checks.at(index)?.passed;
      if (passed === undefined) return [];
      const described = describeCheck(check, words);
      return [
        passed
          ? tryItPrompts.checkPassed({ check: described })
          : tryItPrompts.checkFailed({ check: described }),
      ];
    });
    const line = {
      branch: step.stepId,
      name: JSON.stringify(path.name),
      status: PATH_WORDS[result.status],
    };
    return [
      checks.length === 0
        ? tryItPrompts.path(line)
        : tryItPrompts.pathWithChecks({ ...line, checks: joinPrompts(checks, "; ") }),
    ];
  });
}

// A tool step's input as the spec writes it: `the label "Pricing"` for a literal, `a label from
// details.city` for a reference.
function specInput(spec: Spec, stepId: string, field: string): PromptText {
  const step = findStep(spec, stepId);
  const value = step?.type === "tool" ? step.input[field] : undefined;
  if (typeof value === "string") {
    return tryItPrompts.literalInput({ field, value: JSON.stringify(value) });
  }
  if (isReference(value)) {
    return tryItPrompts.referenceInput({ field, reference: value.from });
  }
  return tryItPrompts.unknownInput({ field });
}

/** The summary as the agent reads it, in the admin's turn. */
export function tryItText(summary: TryItSummary): PromptText {
  return joinPrompts(
    [tryItPrompts.summary(), ...summary.lines.map((line) => tryItPrompts.summaryLine({ line }))],
    "\n",
  );
}
