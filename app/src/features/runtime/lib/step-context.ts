// What executors take and give back.
import type { ModelRole, Spec, Step } from "@/features/spec/types";
import type { Ctx } from "@/lib/ctx";
import type { Json } from "../types";

/**
 * What a step sees: the run it's in, the version's spec (so a draft can re-read a range an
 * earlier step read) and the outputs of the steps before it.
 */
export type StepContext = {
  ctx: Ctx;
  run: { id: string; workflowId: string; connectionId: string; sourceRef: string };
  spec: Spec;
  outputs: Readonly<Record<string, Json>>;
};

/** What a step did. */
export type StepExecution = {
  /** Go on to the next step, or end the run `skipped` or `escalated`. */
  next: "continue" | "skipped" | "escalated";
  /** Handed on to later steps through the step state: derived data only (ADR-0012). */
  output: Json;
  /** What run_steps keeps: no content, and an extract's field names but not their values. */
  record: Json;
  model?: { role: ModelRole; modelId: string; costUsd: number };
};

/**
 * One catalog action: a Nango proxy call with the action's validated input. `marker` names the
 * run and step (`<runId>/<stepId>`), for a write to find what an earlier try already did.
 */
export type ActionRun = (
  ctx: Ctx,
  connectionId: string,
  input: never,
  marker: string,
) => Promise<Json>;

export type StepRun<S extends Step> = (step: S, context: StepContext) => Promise<StepExecution>;

/** A registry entry: built, or pending with the ticket that builds it. */
export type Executor<Run> = { status: "ready"; run: Run } | { status: "pending"; ticket: string };
