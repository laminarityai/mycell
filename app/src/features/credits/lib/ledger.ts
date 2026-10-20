// Credits first (invariant 7): every model call checks the balance before it's made, and records
// what it cost after. The balance is the sum of the org's ledger.
import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { env } from "@/env";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, OutOfCreditsError, ValidationError } from "@/lib/errors";
import type { LedgerEntry, Usage } from "../types";
import { creditLedger } from "./schema";

/** The org's credits left. */
export async function getBalance(ctx: Ctx): Promise<number> {
  // forOrg has no aggregates; the ledger stays small until M7's budgets need a stored balance.
  const rows = await forOrg(ctx).select(creditLedger);
  return rows.reduce((sum, row) => sum + row.amount, 0);
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
    // `|| 0` turns a free call's -0 into 0.
    amount: -(usage.costUsd * env.CREDITS_PER_USD) || 0,
    role: usage.role,
    modelId: usage.modelId,
    outcome: usage.outcome,
    costUsd: usage.costUsd,
    generationId: usage.generationId ?? null,
    workflowId: usage.workflowId ?? null,
    runId: usage.runId ?? null,
  });
  const row = inserted.at(0);
  // An insert returns its row, so this is a bug, not something a user can act on: it's left a
  // plain Error for the action boundary to rethrow (src/lib/errors.ts, actionError).
  if (row === undefined) throw new Error("The usage entry wasn't recorded.");
  return toEntry(row);
}

/** Adds credits to the org. Our team only, through the grant script's system ctx. */
export async function grantCredits(ctx: Ctx, amount: number): Promise<LedgerEntry> {
  if (ctx.role !== "system") throw new ForbiddenError();
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
  if (row === undefined) throw new Error("The grant wasn't recorded.");
  return toEntry(row);
}

/** The org's ledger, newest first. Admins (and jobs) only. */
export async function listLedger(ctx: Ctx, limit = 100): Promise<LedgerEntry[]> {
  if (ctx.role === "member") throw new ForbiddenError();
  const rows = await forOrg(ctx).select(creditLedger, {
    orderBy: [desc(creditLedger.createdAt), desc(creditLedger.id)],
    limit,
  });
  return rows.map(toEntry);
}

function toEntry(row: typeof creditLedger.$inferSelect): LedgerEntry {
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
    createdAt: row.createdAt,
  };
}
