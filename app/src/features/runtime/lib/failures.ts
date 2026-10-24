// What a failed step attempt means: its code, a message built from codes and field names only
// (invariant 8: Inngest and run_steps keep it, and the original error may quote content), whether
// another attempt could help, and how the run ends if it was the last.
import { isForeignKeyViolation } from "@/db/errors";
import { SourceRequestError } from "@/features/connections/types";
import { ModelCallError } from "@/features/models/types";
import { NotFoundError, OutOfCreditsError } from "@/lib/errors";
import { INTERNAL_ERROR_MESSAGE } from "../types";
import { StepCheckError, type StepCheck } from "./checks";

export const runStepErrorCodes = [
  // The executor for this action or step type isn't built yet.
  "not_available",
  // A reference named an output or trigger field that isn't there.
  "bad_reference",
  // A tool's resolved input didn't match its catalog action's input schema.
  "invalid_input",
  // The source has no such item (Gmail, Sheets or Tasks answered 404).
  "source_item_missing",
  // The source refused the account access to the item (Sheets or Tasks answered 403).
  "source_forbidden",
  // An executor's result didn't match its catalog action's output schema.
  "invalid_output",
  // The task was assigned to the person from Docs or Chat, which Mycel leaves alone.
  "task_assigned",
  // A custom action's app has no connection the run may call it through (ADR-0018).
  "app_not_connected",
] as const;
export type RunStepErrorCode = (typeof runStepErrorCodes)[number];

/** A step failed for a reason of runtime's own. The message holds no content. */
export class RunStepError extends Error {
  readonly code: RunStepErrorCode;
  readonly retryable: boolean;

  constructor(code: RunStepErrorCode, message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "RunStepError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export type Failure = {
  code: string;
  message: string;
  retryable: boolean;
  /** How the run ends when this failure ends the step. */
  runStatus: "failed" | "cancelled";
  /** How the step is recorded: a failed check is told apart from a step that broke. */
  stepStatus: "failed" | "check_failed";
};

const CHECK_CODES: Record<StepCheck, string> = {
  schema: "check_schema",
  minP: "check_min_p",
  requiredFields: "check_required_fields",
};

// The status Nango's proxy answers when the app refused to refresh the connection's token.
const TOKEN_REFUSED = 424;

/**
 * Step failure codes that come from one connection or from credits rather than from the
 * workflow, so they don't count toward pausing it (M8): one person's broken connection mustn't
 * pause everyone, and running out of credits pauses every workflow anyway.
 */
export const NOT_THE_WORKFLOWS_FAULT: ReadonlySet<string> = new Set([
  "out_of_credits",
  "connection_gone",
  "app_not_connected",
  "source_forbidden",
  "needs_reconnect",
]);

// A write that hits one of these means the run's connection, and with it the run, is gone.
const GONE_FOREIGN_KEYS = ["runs_connection_fk", "run_steps_connection_fk", "run_steps_run_fk"];

/**
 * Describes a thrown error without quoting it. A failed check is never retried: the same
 * question would get the same answer. Everything else is a step that broke.
 */
export function describeFailure(error: unknown): Failure {
  if (error instanceof StepCheckError) {
    return {
      code: CHECK_CODES[error.check],
      message: error.message,
      retryable: false,
      runStatus: "failed",
      stepStatus: "check_failed",
    };
  }
  return { ...describeBreak(error), stepStatus: "failed" };
}

function describeBreak(error: unknown): Omit<Failure, "stepStatus"> {
  if (isConnectionGone(error)) {
    return {
      code: "connection_gone",
      message: "The connection was deleted.",
      retryable: false,
      runStatus: "cancelled",
    };
  }
  if (error instanceof OutOfCreditsError) {
    return {
      code: "out_of_credits",
      message: error.message,
      retryable: false,
      runStatus: "failed",
    };
  }
  if (error instanceof RunStepError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      runStatus: "failed",
    };
  }
  if (error instanceof ModelCallError) {
    return {
      code: `model_${error.code}`,
      message: error.message,
      retryable: true,
      runStatus: "failed",
    };
  }
  // Nango's 424: the app refused the connection's token, so nothing reaches it until its owner
  // reconnects. Another attempt wouldn't help.
  if (error instanceof SourceRequestError && error.status === TOKEN_REFUSED) {
    return {
      code: "needs_reconnect",
      message: "The app refused the connection's sign-in. Reconnect it.",
      retryable: false,
      runStatus: "failed",
    };
  }
  if (error instanceof SourceRequestError) {
    return {
      code: "source_error",
      message: `The source answered ${String(error.status)}.`,
      retryable: true,
      runStatus: "failed",
    };
  }
  return {
    code: "internal_error",
    message: INTERNAL_ERROR_MESSAGE,
    retryable: true,
    runStatus: "failed",
  };
}

/**
 * Records an unexpected error, a bug of ours, in the server log, where our team finds it: its
 * code and the run's and step's IDs, never the error's message, which may quote an app's or a
 * model's answer (invariant 8).
 */
export function logInternalError(ids: { runId: string; stepId?: string }): void {
  const step = ids.stepId === undefined ? "" : ` step=${ids.stepId}`;
  console.error(`internal_error run=${ids.runId}${step}`);
}

/** NotFoundError from `connections`, or a write that broke the run's foreign keys. */
export function isConnectionGone(error: unknown): boolean {
  if (error instanceof NotFoundError) return true;
  return GONE_FOREIGN_KEYS.some((name) => isForeignKeyViolation(error, name));
}
