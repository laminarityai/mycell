// PROTOTYPE, throwaway: the checks and errors a run's step reports, as `getRun` would type them.

export type CheckKind = "schema" | "confidence" | "required_fields";

export const CHECK_NAME: Record<CheckKind, string> = {
  schema: "Schema",
  confidence: "Confidence",
  required_fields: "Required fields",
};

export type StepCheck = { kind: CheckKind; passed: boolean; says: string };

export type StepError = {
  code: string;
  /** Content-free, safe to show to anyone who sees the run. */
  message: string;
  /** What to do about it, in the reader's words. */
  todo: string;
  /** Our bug, not the workflow's: nothing to change. */
  ours?: boolean;
};
