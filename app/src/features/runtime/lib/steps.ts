// The model and control steps: classify, extract, branch and escalate. A model step fetches
// the triggering message inside itself and holds its text in memory only (invariant 8).
import { z } from "zod";
import { checkWords } from "@/features/policy/condition-fields";
import type { Step } from "@/features/spec/types";
import { ItemGoneError } from "@/lib/errors";
import type { Json } from "../types";
import { callModel } from "./call-model";
import { classify } from "./classify";
import { chooseEveryMatch, chooseFirstMatch } from "./conditions";
import { escalationAdapter } from "./escalation-adapter";
import { messageText } from "./gmail";
import type { StepContext, StepExecution } from "./step-context";
import { withTriggerFacts } from "./trigger-facts";

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
 * Chooses where the run goes: the first path, left to right, whose condition holds (first
 * match) or every one that holds (every match), or the otherwise path when none does; with
 * nothing on the otherwise path, the run stops here. The output names the paths taken, for the
 * walker. The record keeps each path's checks as passed or failed, never the values they tested.
 */
export async function branchStep(
  step: StepOf<"branch">,
  context: StepContext,
): Promise<StepExecution> {
  const choose = step.mode === "every" ? chooseEveryMatch : chooseFirstMatch;
  const outputs = await withTriggerFacts(step, context);
  const { taken, paths } = choose(step, outputs, checkWords(context.spec, context.actionSet));
  const stops = taken.includes(step.otherwise.id) && step.otherwise.steps.length === 0;
  // The paths checked, with each check's pass or fail; never a reason, which may quote a value.
  const checked = paths
    .filter((path) => path.id !== step.otherwise.id && path.status !== "not_checked")
    .map((path) => ({
      id: path.id,
      holds: path.status === "taken",
      checks: path.checks.map((check) => check.passed),
    }));
  return {
    next: stops ? "skipped" : "continue",
    output: { taken },
    record: { taken, paths: checked },
    paths,
  };
}

/**
 * Hands the message to a person: an escalation review points at it, made once however often
 * the step is retried. A message already gone leaves nothing to review, and the run still ends
 * `escalated`.
 */
export async function escalateStep(
  step: StepOf<"escalate">,
  context: StepContext,
): Promise<StepExecution> {
  const { ctx, run } = context;
  try {
    const item = await escalationAdapter.prepare(ctx, {
      connectionId: run.connectionId,
      messageId: run.sourceRef,
    });
    await context.awaitReview({ kind: "escalation", ...item, reason: step.reason });
  } catch (error) {
    if (!(error instanceof ItemGoneError)) throw error;
  }
  return { next: "escalated", output: null, record: null };
}
