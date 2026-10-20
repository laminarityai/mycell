// Runtime's public types: what a model call takes and returns, and the error it throws.
import type { LanguageModel } from "ai";
import type { z } from "zod";
import type { ActionName } from "@/features/policy/catalog";
import type { ModelRole, StepType } from "@/features/spec/types";

/** What a model call is for; recorded on its ledger entry. */
export type CallAttribution = { workflowId?: string; runId?: string };

/** A streamed call's model and its metering (`openMeteredStream`). */
export type MeteredStream = {
  modelId: string;
  model: LanguageModel;
  /** Adds one finished model step's cost, read from its `providerMetadata.gateway`. */
  meterStep(providerMetadata: unknown): void;
  /**
   * Records the call's usage: the cost of every step metered so far. Only the first call
   * records; later ones do nothing, so every way a stream can end may call it.
   */
  finish(outcome: "succeeded" | "failed"): Promise<void>;
};

/** A text call. */
export type TextRequest = CallAttribution & {
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
};

/** A structured-output call: the answer must parse with `schema`. */
export type ObjectRequest<T> = TextRequest & { schema: z.ZodType<T> };

/** A model call's answer, the model the role resolved to, and what the gateway charged. */
export type ModelResult<T> = { output: T; modelId: string; costUsd: number };

/** A classify answer, normalized: Jev's own format never leaves the adapter. */
export type Classification = {
  label: string;
  p: number;
  modelId: string;
  costUsd: number;
  /**
   * True when Jev failed (or the classify model isn't a decision model) and the `fast` role
   * answered with a structured output instead; `p` is then the model's stated confidence.
   */
  fallback: boolean;
};

/** A classify request: which label, of 2 to 10, fits `state` best. */
export type ClassifyRequest = CallAttribution & {
  question: string;
  labels: string[];
  /** What to classify, such as the message's sender, subject and text, held in memory only. */
  state: string;
};

export const modelCallErrorCodes = [
  // The gateway answered with an error, or couldn't be reached.
  "gateway_error",
  // The answer didn't match the request's schema.
  "off_schema",
  // Jev refused to answer the question.
  "refused",
  // Jev answered without probabilities, so there is no confidence to gate on.
  "no_probabilities",
  // Jev chose something that isn't one of the labels.
  "unknown_label",
] as const;
export type ModelCallErrorCode = (typeof modelCallErrorCodes)[number];

/**
 * A model call failed. Its message is built from codes only and it carries no `cause`, because
 * Inngest stores a step's thrown error, and the AI SDK's errors quote the model's output
 * (invariant 8).
 */
export class ModelCallError extends Error {
  readonly code: ModelCallErrorCode;
  readonly role: ModelRole;
  readonly modelId: string;
  /** The gateway's HTTP status, when it answered with an error. */
  readonly status: number | undefined;

  constructor(code: ModelCallErrorCode, role: ModelRole, modelId: string, status?: number) {
    super(
      `The ${role} model call to ${modelId} failed: ${code}` +
        (status === undefined ? "." : ` (${String(status)}).`),
    );
    this.name = "ModelCallError";
    this.code = code;
    this.role = role;
    this.modelId = modelId;
    this.status = status;
  }
}

/** JSON: what a step hands on, since Inngest stores it and replays it instead of re-running. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Runs one named step: Inngest's `step.run` in the job, called straight through elsewhere. A
 * finished step's result is replayed, never re-run, so a retry repeats no earlier step.
 */
export type RunStep = <T extends Json>(id: string, run: () => Promise<T>) => Promise<T>;

/**
 * How often a failing step is tried, and how long it waits before attempt `attempt + 1`. The
 * attempts run inside the step, so each one is counted on the step's record.
 */
export type RetryPolicy = {
  attempts: number;
  delayMs: (attempt: number) => number;
  sleep: (ms: number) => Promise<void>;
};

export const runStatuses = [
  "running",
  "succeeded",
  // A branch's condition failed and its `else` was `stop`.
  "skipped",
  "escalated",
  // The connection went before the run finished.
  "cancelled",
  "failed",
] as const;
export type RunStatus = (typeof runStatuses)[number];

export const runStepStatuses = ["succeeded", "failed", "check_failed", "skipped"] as const;
export type RunStepStatus = (typeof runStepStatuses)[number];

/** How a run ended, as `executeRun` returns it. */
export type RunOutcome = { status: Exclude<RunStatus, "running"> };

/**
 * One step of a run, as recorded: derived data only (labels, probabilities, IDs, counts, field
 * names), never message content or generated text (invariant 8, ADR-0012).
 */
export type RunStepRecord = {
  stepId: string;
  type: StepType;
  status: RunStepStatus;
  attempts: number;
  /** When the last attempt began. */
  lastAttemptAt: Date;
  output: Json;
  errorCode: string | null;
  errorMessage: string | null;
  modelRole: ModelRole | null;
  modelId: string | null;
  costUsd: number;
  startedAt: Date;
  finishedAt: Date;
};

/** A run of a workflow version on one message, with its steps in order. */
export type RunRecord = {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  connectionId: string;
  ownerScope: "member" | "org";
  enablementId: string | null;
  /** The triggering Gmail message's ID. */
  sourceRef: string;
  status: RunStatus;
  costUsd: number;
  startedAt: Date;
  finishedAt: Date | null;
  steps: RunStepRecord[];
};

/** Whether runtime can execute each catalog action and step type yet. */
export type ExecutorCoverage = {
  actions: Record<ActionName, "ready" | "pending">;
  steps: Record<StepType, "ready" | "pending">;
};
