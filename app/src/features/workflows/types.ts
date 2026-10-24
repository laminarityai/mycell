import type { CustomActionRecord } from "@/features/custom-actions/types";
import type { InsertedApproval, RequirementsGained, RiskLevel } from "@/features/policy/types";
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
  /**
   * Custom actions the spec brings with it, as accepted from the builder proposal `proposalId`
   * (ADR-0018): stored in the same transaction as the spec, so neither is stored without the
   * other.
   */
  newCustomActions?: { actions: readonly CustomActionRecord[]; proposalId: string };
};

/** What saving showed: the working spec's max risk and the approvals the policy inserted. */
export type SavedWorkflow = {
  id: string;
  /** The working spec's revision after this save. */
  revision: number;
  maxRisk: RiskLevel;
  inserted: InsertedApproval[];
};

/** A save read and validated before its transaction (checkWorkflowSave), ready to write. */
export type CheckedSave = {
  workflowId: string | undefined;
  /** The revision an existing workflow's working spec must still be at. */
  baseRevision: number;
  values: { name: string; specId: string; workingSpec: Spec };
  /** The custom actions it brings, checked again, and the proposal they came from. */
  newCustomActions: { actions: CustomActionRecord[]; proposalId: string } | undefined;
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
  /** Whether its reviews may be handed to a colleague: the spec's `review.handoff`. */
  handoff?: boolean;
};

/**
 * What a workflow's reviews need to know of it: whether the caller sees it through its tags
 * (an admin sees every one), so may see its org reviews; the names of the tags its latest
 * version is published to that the caller may know (a member's own among them, an admin's every
 * one), by name; and whether that version lets a review be handed on (`review.handoff`).
 */
export type ReviewSharing = { seen: boolean; handOff: boolean; tags: string[] };

/**
 * A workflow that uses an action, as the custom actions page lists it: in its working spec, in
 * its latest version (the one that runs), or both.
 */
export type ActionUse = {
  workflowId: string;
  name: string;
  inWorkingSpec: boolean;
  /** The latest version's number when that version uses it; null when it doesn't or none is. */
  publishedVersion: number | null;
  archived: boolean;
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
  /** Whose connections the latest version runs on; null while not published. */
  credentials: Spec["credentials"] | null;
  /** The apps the latest version uses, as admins name them; none while not published. */
  requiredApps: string[];
  /** The caller's enablement, or the org switch; null while off. */
  switch: WorkflowSwitch | null;
  /** Who the latest version is published to; null while not published. */
  audience: Audience | null;
  /** When an admin archived it, which stops it everywhere; null while not archived. */
  archivedAt: Date | null;
  updatedAt: Date;
};

/** A workflow's working spec, as the builder chat's context lists every workflow's. */
export type WorkingSpecSummary = {
  id: string;
  name: string;
  workingSpec: Spec;
  /** The latest version's number; null while not published. */
  latestVersionNumber: number | null;
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
  /** The apps the latest version uses, as admins name them ("Gmail", "Sheets", "Calendar"). */
  requiredApps: string[];
  maxRisk: RiskLevel;
  /** `org` runs on a shared inbox that only admins switch on. */
  credentials: Spec["credentials"];
  /** The address of the shared inbox the org switch is on; null for a member workflow, or off. */
  sharedInbox: string | null;
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
  /** When an admin archived it, which stops it everywhere; null while not archived. */
  archivedAt: Date | null;
  createdBy: string;
  updatedAt: Date;
};

/**
 * Where a workflow is switched on: by the caller's own enablement (`member`) or the org switch
 * (`org`), the connection it runs on, since when, and what pauses it. `status` and
 * `pausedReason` are what's stored (an enablement only); `pauses` is every pause that holds,
 * stored or worked out. `needsReconnect` when Google refused the connection's token: nothing
 * runs on it until its owner reconnects, though the switch stays as it is (a connection state,
 * not a pause).
 */
export type WorkflowSwitch = {
  kind: "member" | "org";
  connectionId: string;
  since: Date;
  /** The stored status: `paused` only until its user enables it again. */
  status: EnablementStatus;
  /** Why it's stored paused; null while stored on. */
  pausedReason: StoredPausedReason | null;
  /** What a `needs_reenable` pause is about; null while on. */
  pausedChange: PausedChange | null;
  /** Every pause that holds, in `PAUSED_REASONS`' order; empty while it runs. */
  pauses: PausedReason[];
  needsReconnect: boolean;
};

/**
 * The caller's own enablement of a member-credential workflow that may start a run now, with
 * the latest version that run would run and the connection it's on: what Ask Mycel runs.
 */
export type StartableEnablement = {
  workflowId: string;
  name: string;
  versionId: string;
  enablementId: string;
  connectionId: string;
};

/** An enablement is `on`, or `paused` (always with its reason) until its user enables it again. */
export type EnablementStatus = "on" | "paused";

/**
 * Why a switch is paused, in the order its effective state picks from: the first that holds is
 * the one shown (M7). M7's budgets add `budget_reached`, and M8's `failures`, between the two.
 * - `out_of_credits`: the company's balance is at or below zero, so no workflow starts a run.
 *   Worked out from the ledger when it's needed, never stored; a grant lifts it.
 * - `needs_reenable`: a new version is riskier or needs more of the connection than the one its
 *   user switched on. Stored on the enablement until they enable it again.
 */
export const PAUSED_REASONS = ["out_of_credits", "needs_reenable"] as const;
export type PausedReason = (typeof PAUSED_REASONS)[number];

/** The pauses an enablement stores, which only its user lifts; the rest are worked out. */
export type StoredPausedReason = Extract<PausedReason, "needs_reenable">;

/**
 * What a `needs_reenable` pause is about: what the versions published since its member last
 * enabled it need that the one they enabled didn't (a higher max risk, new apps, new scopes).
 */
export type PausedChange = RequirementsGained;

/**
 * What publishing a spec would do to the workflow's enablements, for the publish dialog: what it
 * needs that the latest version didn't (null when nothing, or when it's the first version), and
 * how many enablements that are on it would pause.
 */
export type PublishPreview = { gained: RequirementsGained | null; pauses: number };

/**
 * What enabling did: switched the enablement on, or what the caller's Google connection must
 * first be given. `connect` when they have none; `reconnect` (naming it) when it wasn't granted
 * an app or scope the latest version needs. Apps as the catalog names them ("Gmail"), scopes by
 * their short name ("gmail.modify").
 */
export type EnableResult =
  | { enabled: true }
  | { needs: "connect"; apps: string[]; scopes: string[] }
  | { needs: "reconnect"; connectionId: string; apps: string[]; scopes: string[] };

/** One user's enablement of a workflow, as admins see who has it on or paused. */
export type EnablementSummary = {
  userId: string;
  name: string;
  /** Stored, as on `WorkflowSwitch`. */
  status: EnablementStatus;
  pausedReason: StoredPausedReason | null;
  pausedChange: PausedChange | null;
  /** Every pause that holds, in `PAUSED_REASONS`' order; empty while it runs. */
  pauses: PausedReason[];
  since: Date;
};

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
  issues: SpecIssue[];
  /** Null while the spec has issues. */
  maxRisk: RiskLevel | null;
  inserted: InsertedApproval[];
};
