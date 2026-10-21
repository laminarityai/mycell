// The model and control steps: classify, extract, branch and escalate. A model step fetches
// the triggering message inside itself and holds its text in memory only (invariant 8).
import { z } from "zod";
import type { Check, Step } from "@/features/spec/types";
import type { Json } from "../types";
import { callModel } from "./call-model";
import { classify } from "./classify";
import { RunStepError } from "./failures";
import { messageText } from "./gmail";
import type { StepContext, StepExecution } from "./step-context";

type StepOf<T extends Step["type"]> = Extract<Step, { type: T }>;

export async function classifyStep(
  step: StepOf<"classify">,
  context: StepContext,
): Promise<StepExecution> {
  const { ctx, run } = context;
  const state = await messageText(ctx, run.connectionId, run.sourceRef);
  const result = await classify(ctx, {
    question: step.question,
    labels: step.labels,
    state,
    ...context.attribution,
  });
  const output = { label: result.label, p: result.p };
  return {
    next: "continue",
    output,
    record: { ...output, fallback: result.fallback },
    model: {
      role: result.fallback ? "fast" : "classify",
      modelId: result.modelId,
      costUsd: result.costUsd,
    },
  };
}

const FIELD_TYPES = { string: z.string(), number: z.number(), boolean: z.boolean() };

/**
 * Fills the step's fields from the message. The values pass to later steps through the step
 * state; the record keeps only which fields were filled (ADR-0012).
 */
export async function extractStep(
  step: StepOf<"extract">,
  context: StepContext,
): Promise<StepExecution> {
  const { ctx, run } = context;
  const text = await messageText(ctx, run.connectionId, run.sourceRef);
  const schema = z.object(
    Object.fromEntries(
      Object.entries(step.fields).map(([name, field]) => [
        name,
        FIELD_TYPES[field.type].nullable().describe(field.description),
      ]),
    ),
  );
  const result = await callModel(ctx, step.role, {
    system: "Extract the fields from the message. Use null for a field the message doesn't give.",
    prompt: text,
    schema,
    ...context.attribution,
  });
  const answer = result.output as Partial<Record<string, string | number | boolean | null>>;
  const values: Record<string, Json> = {};
  const filled: Record<string, boolean> = {};
  for (const name of Object.keys(step.fields)) {
    const value = answer[name] ?? null;
    values[name] = value;
    filled[name] = value !== null && value !== "";
  }
  return {
    next: "continue",
    output: values,
    record: { fields: filled },
    model: { role: step.role, modelId: result.modelId, costUsd: result.costUsd },
  };
}

/**
 * Chooses where the run goes: the first path, left to right, whose condition holds, or the
 * otherwise path when none does; with nothing on the otherwise path, the run stops here. The
 * output names the path taken, for the walker. The record keeps each path's checks as passed
 * or failed, never the values they tested.
 */
export function branchStep(step: StepOf<"branch">, context: StepContext): Promise<StepExecution> {
  const paths = step.paths.map((path) => {
    const checks = path.condition.checks.map((check) => checkHolds(check, context.outputs));
    const holds = path.condition.combine === "all" ? checks.every(Boolean) : checks.some(Boolean);
    return { id: path.id, holds, checks };
  });
  const matched = paths.find((path) => path.holds);
  const taken = [matched?.id ?? step.otherwise.id];
  const stops = matched === undefined && step.otherwise.steps.length === 0;
  return Promise.resolve({
    next: stops ? "skipped" : "continue",
    output: { taken },
    record: { taken, paths },
  });
}

function checkHolds(check: Check, outputs: StepContext["outputs"]): boolean {
  if (!("classify" in check)) {
    throw new RunStepError("bad_reference", "Only a classify answer can be checked for now.");
  }
  const classified = classification(outputs[check.classify]);
  if (classified === undefined) {
    throw new RunStepError("bad_reference", `The step ${check.classify} has no classification.`);
  }
  return classified.label === check.is && classified.p >= check.minP;
}

export function escalateStep(): Promise<StepExecution> {
  return Promise.resolve({ next: "escalated", output: null, record: null });
}

function classification(output: Json | undefined): { label: string; p: number } | undefined {
  const parsed = z.object({ label: z.string(), p: z.number() }).safeParse(output);
  return parsed.success ? parsed.data : undefined;
}
