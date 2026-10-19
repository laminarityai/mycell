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
