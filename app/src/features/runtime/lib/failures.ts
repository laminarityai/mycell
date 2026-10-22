// What a failed step attempt means: its code, a message built from codes and field names only
// (invariant 8: Inngest and run_steps keep it, and the original error may quote content), whether
// another attempt could help, and how the run ends if it was the last.
import { isForeignKeyViolation } from "@/db/errors";
import { SourceRequestError } from "@/features/connections/types";
import { NotFoundError, OutOfCreditsError } from "@/lib/errors";
import { ModelCallError } from "../types";
import { StepCheckError, type StepCheck } from "./checks";

export const runStepErrorCodes = [
  // The executor for this action or step type isn't built yet.
  "not_available",
  // A reference named an output or trigger field that isn't there.
  "bad_reference",
  // A tool's resolved input didn't match its catalog action's input schema.
  "invalid_input",
  // The source has no such item (Gmail or Sheets answered 404).
  "source_item_missing",
  // The source refused the account access to the item (Sheets answered 403).
  "source_forbidden",
  // An executor's result didn't match its catalog action's output schema.
  "invalid_output",
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
    message: "The step failed unexpectedly.",
    retryable: true,
    runStatus: "failed",
  };
}

/** NotFoundError from `connections`, or a write that broke the run's foreign keys. */
export function isConnectionGone(error: unknown): boolean {
  if (error instanceof NotFoundError) return true;
  return GONE_FOREIGN_KEYS.some((name) => isForeignKeyViolation(error, name));
}
