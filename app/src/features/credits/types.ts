// The credit ledger's public types.
import type { ModelRole } from "@/features/spec/types";

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
  createdAt: Date;
};
