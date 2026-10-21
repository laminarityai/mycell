import type { InsertedApproval, RiskLevel } from "@/features/policy/types";
import type { Spec, SpecIssue } from "@/features/spec/types";
import type { Tag } from "@/features/tags/types";

/** What an admin saves: a name and the spec as parsed JSON, not yet validated. */
export type WorkflowInput = {
  /** Left out to create a workflow; set to replace that workflow's working spec. */
  workflowId?: string;
  name: string;
  spec: unknown;
  /**
   * The revision of the working spec this was edited from. When set, the save is refused with
   * ConflictError if the working spec has moved on since.
   */
  baseRevision?: number;
};

/** What saving showed: the working spec's max risk and the approvals the policy inserted. */
export type SavedWorkflow = {
  id: string;
  /** The working spec's revision after this save. */
  revision: number;
  maxRisk: RiskLevel;
  inserted: InsertedApproval[];
};

/**
 * What the publish dialog chose, saved into the working spec as it's published. A setting left
 * out keeps what the working spec says.
 */
export type PublishSettings = {
  /** The tag names to publish to: the spec's `visibility.tags`. */
  tags?: readonly string[];
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
  /** The caller's enablement, or the org switch; null while off. */
  switch: WorkflowSwitch | null;
  /** Who the latest version is published to; null while not published. */
  audience: Audience | null;
  updatedAt: Date;
};

/**
 * A published workflow as the Workflows page shows it to someone who can see it: what its latest
 * version does and needs, and the caller's switch.
 */
export type VisibleWorkflow = {
  id: string;
  name: string;
  /** What the latest version does, a sentence per step. */
  description: string[];
  /** The apps the latest version uses, as the catalog names them ("Gmail", "Sheets"). */
  requiredApps: string[];
  maxRisk: RiskLevel;
  /** `org` runs on a shared inbox that only admins switch on. */
  credentials: Spec["credentials"];
  versionNumber: number;
  /** The caller's enablement, or the org switch; null while off. */
  switch: WorkflowSwitch | null;
  /** Who the latest version is published to: admins only, null for members. */
  audience: Audience | null;
};

/** The tags a workflow version is published to, and how many users have any of them. */
export type Audience = { tags: Tag[]; reach: number };

/** A workflow's page: its working spec, what the policy makes of it, and its versions. */
export type WorkflowDetails = {
  id: string;
  name: string;
  specId: string;
  workingSpec: Spec;
  /** Counts the working spec's saves; a save with an older base revision is refused. */
  revision: number;
  /** The working spec differs from the latest version, or nothing is published yet. */
  unpublishedChanges: boolean;
  /** Null when the working spec no longer passes the policy (the catalog changed). */
  maxRisk: RiskLevel | null;
  inserted: InsertedApproval[];
  /** Newest first. */
  versions: WorkflowVersionSummary[];
  /** The caller's enablement, or the org switch; null while off. */
  switch: WorkflowSwitch | null;
  createdBy: string;
  updatedAt: Date;
};

/**
 * Where a workflow is switched on: by the caller's own enablement (`member`) or the org switch
 * (`org`), the connection it runs on, and since when.
 */
export type WorkflowSwitch = { kind: "member" | "org"; connectionId: string; since: Date };

/** What switched a workflow on: one admin's enablement, or an org workflow's org switch. */
export type Switch = { kind: "member"; enablementId: string } | { kind: "org"; workflowId: string };

/** One enablement or org switch on a connection, as the trigger's fan-out reads it. */
export type SwitchedOn = {
  workflowId: string;
  switch: Switch;
  /** The latest version, which the run pins. */
  versionId: string;
  /** Messages that occurred before this start nothing. */
  since: Date;
  /** The trigger's label filter: a message starts a run when it has one of them. */
  labelIds: string[];
};

/** A spec that passed every validation stage, with what the policy engine made of it. */
export type ValidatedSpec = {
  /** The working spec, as parsed: before the policy engine inserted anything. */
  working: Spec;
  /** The spec a version would hold: after `applyPolicy`. */
  applied: Spec;
  maxRisk: RiskLevel;
  inserted: InsertedApproval[];
  requiredActions: string[];
};

/** Save-time validation's verdict, for callers that show issues rather than throw them. */
export type SpecCheck = ({ ok: true } & ValidatedSpec) | { ok: false; issues: SpecIssue[] };

/** The editor's live validation: the spec's issues, or what the policy engine made of it. */
export type SpecCheckResult = {
  /** Set when the check itself was refused (a member, say). */
  error?: string;
  issues: SpecIssue[];
  /** Null while the spec has issues. */
  maxRisk: RiskLevel | null;
  inserted: InsertedApproval[];
};
