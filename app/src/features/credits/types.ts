// The credit ledger's public types.
import type { ModelRole } from "@/features/spec/types";

/**
 * What a usage was spent on, when no run or Try it made it: `memory`, learning from the
 * company's apps, which memory's monthly budget caps (ADR-0022); `memory_summary`, a person's
 * own summary of what memory knows, outside that budget; `builder`, the builder chat's turns
 * and what they ask for; or `agent`, a person's Ask Mycel turns and what they ask for (the
 * injection screen of what its tools read, say). A run's usage names its workflow and run
 * instead, and Try it's is marked `dryRun`.
 */
export const CREDIT_PURPOSES = ["memory", "memory_summary", "builder", "agent"] as const;
export type CreditPurpose = (typeof CREDIT_PURPOSES)[number];

/** The kinds of use the Credits page splits spending into. */
export const SPENDING_KINDS = ["workflow", "memory", "builder", "agent", "try_it"] as const;
export type SpendingKind = (typeof SPENDING_KINDS)[number];

/** One model call's usage, as the gateway client (or the injection screen) records it. */
export type Usage = {
  /** The role the call named; null for a fixed service that names none (the injection screen). */
  role: ModelRole | null;
  modelId: string;
  /**
   * The gateway's reported cost in US dollars, or the injection screen's estimate at its list
   * price; 0 when the call failed without one.
   */
  costUsd: number;
  outcome: "succeeded" | "failed";
  generationId?: string;
  workflowId?: string;
  runId?: string;
  /** Made by a dry run ("Try it"), which has no run record. */
  dryRun?: boolean;
  purpose?: CreditPurpose;
};

/** A row of the ledger: a grant or a usage. `amount` is in credits. */
export type LedgerEntry = {
  id: string;
  kind: "grant" | "usage";
  amount: number;
  role: ModelRole | null;
  modelId: string | null;
  outcome: "succeeded" | "failed" | null;
  costUsd: number | null;
  generationId: string | null;
  workflowId: string | null;
  runId: string | null;
  dryRun: boolean;
  purpose: CreditPurpose | null;
  /**
   * A failed call's correction: the usage entry whose billed cost it records, with the same
   * attribution and time. Null for every other entry.
   */
  correctsId: string | null;
  createdAt: Date;
};

/** A failed call whose billed cost is still to be looked up: recorded at 0, under a generation. */
export type UncostedFailedCall = { id: string; generationId: string; createdAt: Date };

/** Which spending `getSpending` adds up: one purpose's usage from a time on. */
export type SpendingQuery = { purpose: CreditPurpose; since: Date };

// The kind of use each purpose is: a person's summaries are memory's on the Credits page,
// though memory's budget adds up only learning.
const KIND_OF_PURPOSE: Record<CreditPurpose, SpendingKind> = {
  memory: "memory",
  memory_summary: "memory",
  builder: "builder",
  agent: "agent",
};

/**
 * Which kind of use a usage entry was, from its attribution: Try it (`dryRun`), a purpose's
 * kind, or a workflow's run. Null for a grant, or usage nothing attributed (a bug: every call
 * says).
 */
export function spendingKindOf(
  entry: Pick<LedgerEntry, "dryRun" | "purpose" | "runId">,
): SpendingKind | null {
  if (entry.dryRun) return "try_it";
  if (entry.purpose !== null) return KIND_OF_PURPOSE[entry.purpose];
  return entry.runId === null ? null : "workflow";
}
