// Runtime's public types: runs, their steps and records, and what a dry run returns.
import type { ActionName } from "@/features/policy/catalog";
import type { GraphTrace } from "@/features/spec/graph";
import type { ModelRole, Spec, StepType } from "@/features/spec/types";
import type { Json } from "@/lib/inngest";
import { z } from "zod";

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

/**
 * Why a run failed as a whole, rather than at one of its steps: `internal_error`, its job
 * crashed past Inngest's retries.
 */
export const runErrorCodes = ["internal_error"] as const;
export type RunErrorCode = (typeof runErrorCodes)[number];

/**
 * What an `internal_error`, a run's or a step's, reads as wherever it's shown: a bug of ours,
 * which the server log records by code and IDs.
 */
export const INTERNAL_ERROR_MESSAGE =
  "Something went wrong on our side. Nothing in the workflow needs changing.";

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
  /** What it cost in credits, at the config's credits-per-dollar ratio. */
  costCredits: number;
  startedAt: Date;
  finishedAt: Date;
  /** The step's checks, as the spec lists them, and how each went. */
  checks: RunStepCheck[];
};

/** One of a step's checks on its output: `schema`, `minP` (confidence) or `requiredFields`. */
export type RunStepCheck = {
  check: "schema" | "minP" | "requiredFields";
  /** `not_checked`: the step broke, or an earlier check failed, before this one was checked. */
  status: "passed" | "failed" | "not_checked";
  /** Why it failed, from check names and field paths only; null unless it failed. */
  reason: string | null;
};

/**
 * A run of a workflow version on one message, with its steps in order, as the caller may see it
 * (`getRun`). It's shown in full only to its connection's readers (its owner, or any admin for
 * an org connection); to an admin who isn't one it's redacted: `full` is false, `sourceRef` null
 * and every step's `output` null, so nothing the run read or handed on is given (ADR-0001).
 */
export type RunRecord = {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowVersionId: string;
  /** The version that ran, spec and all; null if it's gone. */
  version: { id: string; number: number; spec: Spec } | null;
  connectionId: string;
  ownerScope: "member" | "org";
  enablementId: string | null;
  startedBy: RunStartedBy;
  inbox: RunInbox;
  /** Shown in full to the caller: its message, and what its steps handed on. */
  full: boolean;
  /** The triggering Gmail message's ID; null when redacted. */
  sourceRef: string | null;
  status: RunStatus;
  /** Why the run failed as a whole; null when it didn't, or failed at its steps. */
  errorCode: RunErrorCode | null;
  costUsd: number;
  /** What it cost in credits, at the config's credits-per-dollar ratio. */
  costCredits: number;
  startedAt: Date;
  finishedAt: Date | null;
  steps: RunStepRecord[];
  /**
   * The steps it reached and the paths each branch took, for the workflow graph to light up as
   * it lights a Try it. A path's checks are given only in full: which of them passed says
   * something of the message.
   */
  trace: GraphTrace;
};

/** What started a run: an admin by hand, a member's enablement, or an org workflow's switch. */
export type RunStartedBy = "manual" | "enablement" | "org_switch";

/** Which runs `listRuns` lists: each filter left out lets every value through. */
export type RunFilters = { workflowId?: string; status?: RunStatus; connectionId?: string };

/**
 * Which page of runs: the newest, or the page just older or newer than a run another page
 * showed (its `older` or `newer`). `size` runs a page, 25 unless given, at most 100.
 */
export type RunPageRequest = { olderThan?: string; newerThan?: string; size?: number };

/** Whose inbox a run ran on, as the person listing it may know it. */
export type RunInbox =
  | { kind: "yours"; accountEmail: string }
  | { kind: "org"; accountEmail: string }
  /** Another member's own: their name alone (ADR-0001). */
  | { kind: "colleague"; ownerName: string };

/**
 * The message that started a run, for someone who may read its connection: its subject and
 * sender fetched from Gmail for display only, never stored (invariant 8). Both are null, and so
 * is the link, when Gmail no longer has it or can't be reached.
 */
export type RunMessage = {
  sourceRef: string;
  subject: string | null;
  from: string | null;
  /** Its thread in Gmail's web app, opened in the inbox's account. */
  link: string | null;
};

/** A step that failed, as a list of runs shows it: codes and words only, so anyone may see it. */
export type RunFailure = {
  stepId: string;
  /** The path it's on, as `RunStepRecord.path` says it. */
  path: string | null;
  status: "failed" | "check_failed";
  errorCode: string | null;
  errorMessage: string | null;
};

/**
 * One run on the Runs page. A run is shown in full only to its connection's readers (its
 * owner, or any admin for an org connection); to anyone else it's redacted: `message` is null,
 * and nothing it read or handed between its steps is given at all (ADR-0001).
 */
export type RunListItem = {
  id: string;
  workflowId: string;
  workflowName: string;
  connectionId: string;
  ownerScope: "member" | "org";
  startedBy: RunStartedBy;
  inbox: RunInbox;
  /** Null when the run is redacted for the caller. */
  message: RunMessage | null;
  status: RunStatus;
  /** Why it failed as a whole (its job crashed); null when it didn't, or failed at its steps. */
  errorCode: RunErrorCode | null;
  costUsd: number;
  /** What it cost in credits, at the config's credits-per-dollar ratio. */
  costCredits: number;
  startedAt: Date;
  finishedAt: Date | null;
  /** Its failed steps, in spec order. */
  failures: RunFailure[];
};

// A query parameter's one value: the first of several, and none for an empty one.
const queryValue = (value: unknown) => {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() !== "" ? first.trim() : undefined;
};
const queryText = z.preprocess(queryValue, z.string().optional());

/**
 * The Runs page's address query: its filters (`workflow`, `status`, `connection`) and the page
 * (`older` or `newer`, a run ID). A value that isn't one is left out, so a stale or edited
 * address lists every run rather than failing.
 */
export const runsQuerySchema = z
  .object({
    workflow: queryText,
    status: z.preprocess(queryValue, z.enum(runStatuses).optional()).catch(undefined),
    connection: queryText,
    older: queryText,
    newer: queryText,
  })
  .transform((query): { filters: RunFilters; page: RunPageRequest } => ({
    filters: {
      workflowId: query.workflow,
      status: query.status,
      connectionId: query.connection,
    },
    page: query.older !== undefined ? { olderThan: query.older } : { newerThan: query.newer },
  }));

/** What the Runs page's filters offer: the workflows and inboxes the caller's runs are on. */
export type RunFilterOptions = {
  workflows: { id: string; name: string }[];
  connections: { id: string; inbox: RunInbox }[];
};

/**
 * A page of runs, newest first, with the cursors of the pages either side: `newer` for
 * `newerThan`, `older` for `olderThan`. Null when there's no such page.
 */
export type RunPage = { runs: RunListItem[]; newer: string | null; older: string | null };

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
