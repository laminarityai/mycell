// The credit ledger's public types.
import type { ModelRole } from "@/features/spec/types";

/**
 * What a usage was spent on, when that has a budget of its own: `memory`, learning from the
 * company's apps, which a monthly memory budget caps (ADR-0022). Other usage has none.
 */
export const CREDIT_PURPOSES = ["memory"] as const;
export type CreditPurpose = (typeof CREDIT_PURPOSES)[number];

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
  createdAt: Date;
};

/** Which spending `getSpending` adds up: one purpose's usage from a time on. */
export type SpendingQuery = { purpose: CreditPurpose; since: Date };
