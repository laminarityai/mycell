// Runtime's public types: runs, their steps and records, and what a dry run returns.
import type { ActionName } from "@/features/policy/catalog";
import type { ModelRole, StepType } from "@/features/spec/types";

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
  // A branch took an otherwise path with no steps.
  "skipped",
  "escalated",
  // The connection went before the run finished.
  "cancelled",
  // The steps above every branch failed, or every path that ran did.
  "failed",
  // Some paths of an every-match branch failed and others finished. A failure wherever
  // failures are counted.
  "partly_failed",
] as const;
export type RunStatus = (typeof runStatuses)[number];

export const runStepStatuses = ["succeeded", "failed", "check_failed", "skipped"] as const;
export type RunStepStatus = (typeof runStepStatuses)[number];

/** How a run ended, as `executeRun` returns it. */
export type RunOutcome = { status: Exclude<RunStatus, "running"> };

/**
 * One field of a tool step's result, as its run record lists it: its kind and, for text, a list
 * or a record, its size (characters, items or fields). Never its value (ADR-0021).
 */
export type ResultField =
  { kind: "text" | "list" | "record"; size: number } | { kind: "number" | "yes_no" | "empty" };

/**
 * One step of a run, as recorded: derived data only (labels, probabilities, IDs, counts, field
 * names, a tool result's field kinds and sizes), never message content or generated text, though
 * a step's output may carry them to later steps (invariant 8, ADR-0021).
 */
export type RunStepRecord = {
  stepId: string;
  type: StepType;
  /**
   * The path the step is on, in words, after the paths it's nested in: "Pricing", "Pricing ›
   * Otherwise". Null for a step above every branch.
   */
  path: string | null;
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
  | { kind: "review"; channel: string }
  /** A custom write's request, exactly as it would be sent once approved (nothing is sent). */
  | {
      kind: "request";
      app: string;
      action: string;
      method: string;
      url: string;
      body: Record<string, unknown> | null;
    };

/**
 * How one check of a path's condition went. `reason` may quote the value it tested, which can
 * come from the email: shown on the admin's page only, never stored or summarized.
 */
export type CheckResult = {
  /** The check in words, from the spec's literals only. */
  check: string;
  passed: boolean;
  reason: string;
};

/**
 * One path out of a branch, as the branch saw it: `taken`; `not_taken`, its condition failed;
 * `not_checked`, an earlier path was taken first; or, for the otherwise path, `not_needed`,
 * another path applied. `checks` follow the path's condition, and are empty when it wasn't
 * checked and for the otherwise path.
 */
export type BranchPath = {
  id: string;
  /** The path's name; none for the otherwise path. */
  name: string | null;
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
  ended: "succeeded" | "skipped" | "escalated" | "failed" | "partly_failed";
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
