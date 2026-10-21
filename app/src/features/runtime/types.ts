// Runtime's public types: what a model call takes and returns, and the error it throws.
import type { LanguageModel } from "ai";
import type { z } from "zod";
import type { ActionName } from "@/features/policy/catalog";
import type { ModelRole, StepType } from "@/features/spec/types";

/** What a model call is for; recorded on its ledger entry. */
export type CallAttribution = { workflowId?: string; runId?: string; dryRun?: boolean };

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

/**
 * What one step of a dry run read or would have written, shown to the admin who tried it and
 * never stored (invariant 8): the rows a read-range read, the draft it would have made, the
 * label or row it would have added, the review it would have waited for.
 */
export type DryRunEffect =
  | { kind: "rows_read"; range: string; rows: string[][] }
  | { kind: "draft"; to: string; subject: string; text: string }
  | { kind: "label"; label: string }
  | { kind: "row"; range: string; values: (string | number | boolean | null)[] }
  | { kind: "review"; channel: string };

/**
 * How one check of a path's condition went. `reason` may quote the value it tested, which can
 * come from the email: shown on the admin's page only, never stored or summarized.
 */
export type CheckResult = { passed: boolean; reason: string };

/**
 * One path out of a branch, as the branch saw it: `taken`; `not_taken`, its condition failed;
 * `not_checked`, an earlier path was taken first; or, for the otherwise path, `not_needed`,
 * another path applied. `checks` follow the path's condition, and are empty when it wasn't
 * checked and for the otherwise path.
 */
export type BranchPath = {
  id: string;
  status: "taken" | "not_taken" | "not_checked" | "not_needed";
  checks: CheckResult[];
};

/** One step of a dry run. */
export type DryRunStep = {
  stepId: string;
  type: StepType;
  status: "succeeded" | "failed" | "check_failed";
  /** An approval the policy engine added, not one the spec names. */
  insertedByPolicy: boolean;
  /** What it handed on to later steps, as a run would. */
  output: Json;
  effect: DryRunEffect | null;
  /** A branch's paths, each otherwise path last, in the order the spec lists them. */
  paths?: BranchPath[];
  /** Why it failed, content-free. */
  error: { code: string; message: string } | null;
  modelId: string | null;
  costUsd: number;
};

/** How a dry run ended, and each step it reached. Returned to the page, never stored. */
export type DryRunResult = {
  ended: "succeeded" | "skipped" | "escalated" | "failed";
  steps: DryRunStep[];
  costUsd: number;
};

/** What a "Try it" Server Action hands the panel: the result, or why it was refused. */
export type TryItState = {
  result?: DryRunResult;
  error?: string;
  issues?: { path: (string | number)[]; message: string }[];
};

/**
 * One connection's share of the newest messages across the "Try it" picker's connections:
 * fetched for display, never stored. `unavailable` when Gmail couldn't be read just now.
 */
export type RecentMessages = {
  connectionId: string;
  accountEmail: string;
  kind: "member" | "org";
  messages: { sourceRef: string; subject: string; from: string; date: string }[];
  unavailable: boolean;
};

/** Whether runtime can execute each catalog action and step type yet. */
export type ExecutorCoverage = {
  actions: Record<ActionName, "ready" | "pending">;
  steps: Record<StepType, "ready" | "pending">;
};
