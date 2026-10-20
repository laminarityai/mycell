import type { InsertedApproval, RiskLevel } from "@/features/policy/types";
import type { Spec } from "@/features/spec/types";

/** What an admin saves: a name and the spec as parsed JSON, not yet validated. */
export type WorkflowInput = {
  /** Left out to create a workflow; set to replace that workflow's working spec. */
  workflowId?: string;
  name: string;
  spec: unknown;
};

/** What saving showed: the working spec's max risk and the approvals the policy inserted. */
export type SavedWorkflow = {
  id: string;
  maxRisk: RiskLevel;
  inserted: InsertedApproval[];
};

/** An immutable snapshot of a workflow's spec, after the policy engine ran on it. */
export type WorkflowVersion = {
  id: string;
  workflowId: string;
  number: number;
  spec: Spec;
  maxRisk: RiskLevel;
  /** The catalog actions the spec calls, each once, in step order. */
  requiredActions: string[];
  publishedBy: string;
  publishedAt: Date;
};

export type WorkflowVersionSummary = Pick<
  WorkflowVersion,
  "id" | "number" | "maxRisk" | "publishedBy" | "publishedAt"
>;

/** A row of the workflows list. */
export type WorkflowSummary = {
  id: string;
  name: string;
  specId: string;
  latestVersion: WorkflowVersionSummary | null;
  updatedAt: Date;
};

/** A workflow's page: its working spec, what the policy makes of it, and its versions. */
export type WorkflowDetails = {
  id: string;
  name: string;
  specId: string;
  workingSpec: Spec;
  /** Null when the working spec no longer passes the policy (the catalog changed). */
  maxRisk: RiskLevel | null;
  inserted: InsertedApproval[];
  /** Newest first. */
  versions: WorkflowVersionSummary[];
  createdBy: string;
  updatedAt: Date;
};
