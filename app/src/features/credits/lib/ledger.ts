// Credits first (invariant 7): every model call checks the balance before it's made, and records
// what it cost after. The balance is the sum of the org's ledger.
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { env } from "@/env";
import { type Ctx, requireRole, requireSystem } from "@/lib/ctx";
import { InvariantError, OutOfCreditsError, ValidationError } from "@/lib/errors";
import type { LedgerEntry, SpendingQuery, Usage } from "../types";
import { creditLedger } from "./schema";

/** The org's credits left. */
export async function getBalance(ctx: Ctx): Promise<number> {
  // Summed in the database: every model call checks it, and the ledger grows by one row per call.
  return forOrg(ctx).sum(creditLedger, creditLedger.amount);
}

/**
 * Whether the org is out of credits: its balance is at or below zero. Every workflow is then
 * paused (no run starts) until a grant lifts it. Worked out from the ledger whenever it's asked,
 * so nothing is written when it starts or ends.
 */
export async function isOutOfCredits(ctx: Ctx): Promise<boolean> {
  return (await getBalance(ctx)) <= 0;
}

/** The credits usage for `purpose` has used up since `since`. Admins (and jobs) only. */
export async function getSpending(ctx: Ctx, query: SpendingQuery): Promise<number> {
  requireRole(ctx, "admin", "system");
  const amount = await forOrg(ctx).sum(
    creditLedger,
    creditLedger.amount,
    and(
      eq(creditLedger.kind, "usage"),
      eq(creditLedger.purpose, query.purpose),
      gte(creditLedger.createdAt, query.since),
    ),
  );
  // Usage is negative; `|| 0` turns no spending's -0 into 0.
  return -amount || 0;
}

/** Throws OutOfCreditsError unless the balance covers `estimate` credits. */
export async function checkCredits(ctx: Ctx, estimate: number): Promise<void> {
  if ((await getBalance(ctx)) < estimate) throw new OutOfCreditsError();
}

/** Records one model call's cost against the org, converted to credits by the config ratio. */
export async function recordUsage(ctx: Ctx, usage: Usage): Promise<LedgerEntry> {
  const inserted = await forOrg(ctx).insert(creditLedger, {
    id: randomUUID(),
    kind: "usage",
    amount: usageAmount(usage.costUsd),
    role: usage.role,
    modelId: usage.modelId,
    outcome: usage.outcome,
    costUsd: usage.costUsd,
    generationId: usage.generationId ?? null,
    workflowId: usage.workflowId ?? null,
    runId: usage.runId ?? null,
    dryRun: usage.dryRun ?? false,
    purpose: usage.purpose ?? null,
  });
  const row = inserted.at(0);
  // An insert returns its row, so this is a bug, not something a user can act on.
  if (row === undefined) throw new InvariantError("The usage entry wasn't recorded.");
  return toEntry(row);
}

/** A usage's ledger amount: its gateway cost in credits, at the config ratio, as a debit. */
export function usageAmount(costUsd: number): number {
  // `|| 0` turns a free call's -0 into 0.
  return -(costUsd * env.CREDITS_PER_USD) || 0;
}

/** Adds credits to the org. Our team only, through the grant script's system ctx. */
export async function grantCredits(ctx: Ctx, amount: number): Promise<LedgerEntry> {
  requireSystem(ctx);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError("A grant is a positive number of credits.");
  }
  const inserted = await forOrg(ctx).insert(creditLedger, {
    id: randomUUID(),
    kind: "grant",
    amount,
  });
  const row = inserted.at(0);
  // A bug, as above.
  if (row === undefined) throw new InvariantError("The grant wasn't recorded.");
  return toEntry(row);
}

/** The org's ledger, newest first. Admins (and jobs) only. */
export async function listLedger(ctx: Ctx, limit = 100): Promise<LedgerEntry[]> {
  requireRole(ctx, "admin", "system");
  const rows = await forOrg(ctx).select(creditLedger, {
    orderBy: [desc(creditLedger.createdAt), desc(creditLedger.id)],
    limit,
  });
  return rows.map(toEntry);
}

export function toEntry(row: typeof creditLedger.$inferSelect): LedgerEntry {
  return {
    id: row.id,
    kind: row.kind,
    amount: row.amount,
    role: row.role,
    modelId: row.modelId,
    outcome: row.outcome,
    costUsd: row.costUsd,
    generationId: row.generationId,
    workflowId: row.workflowId,
    runId: row.runId,
    dryRun: row.dryRun,
    purpose: row.purpose,
    correctsId: row.correctsId,
    createdAt: row.createdAt,
  };
}
