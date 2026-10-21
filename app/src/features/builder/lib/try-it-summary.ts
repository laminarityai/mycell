// A try-it result as the conversation keeps it, for the agent to react to: one line per step
// saying what it did, in words built from the spec's own literals (labels, step IDs, ranges)
// and counts only. No message content, draft text, row value or extracted value reaches it
// (invariant 8): those stay on the admin's page. A tool input the spec fills from a reference
// is named by its reference, never by the value it resolved to, which may come from the email.
import type { DryRunResult, DryRunStep } from "@/features/runtime/types";
import { findStep } from "@/features/spec/tree";
import type { Spec } from "@/features/spec/types";
import type { TryItSummary } from "../types";

const ENDINGS: Record<DryRunResult["ended"], string> = {
  succeeded: "It ran to the end.",
  skipped: "It stopped at a branch: the workflow would do nothing more with this message.",
  escalated: "It escalated: the workflow would hand this message to a person.",
  failed: "It failed at the step above.",
};

/** Summarizes a dry run of `spec`. */
export function summarizeTryIt(result: DryRunResult, spec: Spec): TryItSummary {
  return {
    lines: [...result.steps.map((step) => lineOf(step, spec)), ENDINGS[result.ended]],
    costUsd: result.costUsd,
  };
}

function lineOf(step: DryRunStep, spec: Spec): string {
  const name = `${step.stepId} (${step.type})`;
  if (step.error !== null) return `${name}: failed, ${step.error.code}: ${step.error.message}`;
  const input = (field: string) => specInput(spec, step.stepId, field);
  const effect = step.effect;
  switch (effect?.kind) {
    case "review":
      return `${name}: would wait for a review${step.insertedByPolicy ? " (required by policy)" : ""}.`;
    case "draft":
      return `${name}: drafted a reply (not saved).`;
    case "label":
      return `${name}: would add ${input("label")}.`;
    case "row":
      return `${name}: would append a row to ${input("range")}.`;
    case "rows_read":
      return `${name}: read ${String(effect.rows.length)} rows from ${input("range")}.`;
    case undefined:
      break;
  }
  const output = step.output;
  if (step.type === "classify" && isRecord(output)) {
    return `${name}: chose ${JSON.stringify(output.label)} with probability ${JSON.stringify(output.p)}.`;
  }
  if (step.type === "branch" && isRecord(output)) {
    return output.passed === true ? `${name}: went on.` : `${name}: its condition failed.`;
  }
  if (step.type === "extract" && isRecord(output)) {
    const filled = Object.entries(output).filter(([, value]) => value !== null && value !== "");
    return `${name}: filled ${filled.map(([field]) => field).join(", ") || "no fields"}.`;
  }
  return `${name}: done.`;
}

// A tool step's input as the spec writes it: `the label "Pricing"` for a literal, `a label from
// details.city` for a reference.
function specInput(spec: Spec, stepId: string, field: string): string {
  const step = findStep(spec, stepId);
  const value = step?.type === "tool" ? step.input[field] : undefined;
  if (typeof value === "string") return `the ${field} ${JSON.stringify(value)}`;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return `a ${field} from ${value.from}`;
  }
  return `the ${field} the spec names`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The summary as the agent reads it, in the admin's turn. */
export function tryItText(summary: TryItSummary): string {
  return [
    "[I tried the workflow's working spec on one real message (Try it). Nothing was written " +
      "to any app. What each step did:]",
    ...summary.lines.map((line) => `- ${line}`),
  ].join("\n");
}
