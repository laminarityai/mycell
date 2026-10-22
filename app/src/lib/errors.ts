// The typed errors server functions throw. Server Actions and routes turn them into messages;
// nothing else catches them (docs/conventions.md, "Errors").

/** A personal Google account tried to sign in: Mycel needs a Workspace domain (ADR-0002). */
export class WorkspaceAccountRequiredError extends Error {
  /** Carried in the sign-in page's `?error=` parameter. */
  static readonly code = "workspace_account_required";

  constructor() {
    super("Mycel needs a Google Workspace account. Sign in with your work Google account.");
    this.name = "WorkspaceAccountRequiredError";
  }
}

/** The caller's role doesn't allow this operation. */
export class ForbiddenError extends Error {
  constructor() {
    super("You're not allowed to do that.");
    this.name = "ForbiddenError";
  }
}

/** The thing doesn't exist in the caller's org. IDs from another org land here too. */
export class NotFoundError extends Error {
  constructor(thing: string) {
    super(`That ${thing} doesn't exist.`);
    this.name = "NotFoundError";
  }
}

/** The operation would break a rule the current state depends on; the message says which. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * Someone acted on a review before the caller did: the first to act wins, and nothing was
 * carried out for the caller. Names who handled it, when someone in Mycel did.
 */
export class AlreadyHandledError extends Error {
  constructor(handledBy?: string) {
    super(
      handledBy === undefined
        ? "This review was already handled."
        : `This review was already handled by ${handledBy}.`,
    );
    this.name = "AlreadyHandledError";
  }
}

/**
 * A review's waiting item is no longer in its app: deleted there, or already carried out. The
 * pending-form adapters throw it; acting on a review turns it into a ConflictError that ends the
 * review, and opening one ends the review `gone`.
 */
export class ItemGoneError extends Error {
  constructor() {
    super("The waiting item is no longer in its app.");
    this.name = "ItemGoneError";
  }
}

/**
 * An approved item Mycel held was handed to its app, but the app never confirmed it: an error
 * or a lost answer after the request may have reached it (ADR-0020). The held-send adapter
 * throws it once the item is no longer held, so nothing sends it again; acting on a review
 * ends the review `unconfirmed` and turns this into a ConflictError.
 */
export class SendUnconfirmedError extends Error {
  constructor() {
    super("The app didn't confirm the send.");
    this.name = "SendUnconfirmedError";
  }
}

/** The input breaks a rule the user can fix; the message says which. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** One reason a spec was refused, at the path of the field it's about (`SpecIssue` in `spec`). */
export type SpecInvalidIssue = { path: (string | number)[]; message: string };

/**
 * A spec failed save-time validation. It carries every issue at once, not just the first, and a
 * message counting them unless one says better what's wrong (a spec that isn't JSON).
 */
export class SpecInvalidError extends Error {
  constructor(
    readonly issues: SpecInvalidIssue[],
    message = issues.length === 1
      ? "The spec has 1 issue."
      : `The spec has ${String(issues.length)} issues.`,
  ) {
    super(message);
    this.name = "SpecInvalidError";
  }
}

/**
 * The org's credit balance can't cover the call it was about to make (invariant 7). Nothing was
 * called and nothing was spent.
 */
export class OutOfCreditsError extends Error {
  constructor() {
    super("Your organization is out of credits.");
    this.name = "OutOfCreditsError";
  }
}

/**
 * What a Server Action returns: `error` holds a message for the user when the write failed,
 * and `issues` every reason a spec was refused. A failed form also gets back the fields it sent
 * (`values`, and `lists` for those read as lists), since React empties a form after its action
 * even when it failed: the form starts its fields from them to keep what the user typed.
 */
export type ActionResult = {
  error?: string;
  issues?: SpecInvalidIssue[];
  values?: Record<string, string>;
  lists?: Record<string, string[]>;
};

/**
 * The action-boundary half of the error rule: a typed error becomes its user-facing message,
 * and anything else is a bug, so it's rethrown for Next.js's error handling.
 */
export function actionError(error: unknown): ActionResult {
  if (error instanceof SpecInvalidError) return { error: error.message, issues: error.issues };
  const message = typedErrorMessage(error);
  if (message !== undefined) return { error: message };
  throw error;
}

/**
 * A typed error's user-facing message, which we write and which quotes no content; undefined
 * for anything else, whose message may quote whatever caused it.
 */
export function typedErrorMessage(error: unknown): string | undefined {
  return error instanceof ForbiddenError ||
    error instanceof NotFoundError ||
    error instanceof ConflictError ||
    error instanceof AlreadyHandledError ||
    error instanceof ItemGoneError ||
    error instanceof ValidationError ||
    error instanceof OutOfCreditsError ||
    error instanceof SpecInvalidError
    ? error.message
    : undefined;
}

/**
 * The route-boundary half: a typed error becomes a status with its message as the body, and
 * anything else is a bug, rethrown for Next.js's error handling.
 */
export function routeError(error: unknown): Response {
  const status =
    error instanceof ForbiddenError
      ? 403
      : error instanceof NotFoundError
        ? 404
        : error instanceof ConflictError || error instanceof AlreadyHandledError
          ? 409
          : error instanceof ItemGoneError
            ? 410
            : error instanceof ValidationError
              ? 400
              : error instanceof OutOfCreditsError
                ? 402
                : undefined;
  if (status === undefined || !(error instanceof Error)) throw error;
  return new Response(error.message, { status });
}
