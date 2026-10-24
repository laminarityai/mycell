// Failed calls' real cost (spec #152, "Failed-call costs"). A model call that fails is recorded
// at the cost its answer reported, 0 when none did, though the AI Gateway may still bill it.
// `models` looks the generation up later and records what it was billed here: a correcting usage
// entry linked to the failed one, with its attribution, so balances and spending match the bill.
import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { type Ctx, requireSystem } from "@/lib/ctx";
import { ValidationError } from "@/lib/errors";
import type { LedgerEntry, UncostedFailedCall } from "../types";
import { toEntry, usageAmount } from "./ledger";
import { creditLedger } from "./schema";

// A failed call's usage entry a correction may follow: recorded at 0 under a generation ID, and
// not itself a correction.
const uncostedFailedCall = (entryId: string) =>
  and(
    eq(creditLedger.id, entryId),
    eq(creditLedger.kind, "usage"),
    eq(creditLedger.outcome, "failed"),
    eq(creditLedger.costUsd, 0),
    isNotNull(creditLedger.generationId),
    isNull(creditLedger.correctsId),
  );

/**
 * The failed call `entryId` names, while its billed cost is still to be recorded; undefined once
 * it's corrected, or when the entry is no such call. Jobs only.
 */
export async function findUncostedFailedCall(
  ctx: Ctx,
  entryId: string,
): Promise<UncostedFailedCall | undefined> {
  requireSystem(ctx);
  const db = forOrg(ctx);
  const [entries, corrections] = await Promise.all([
    db.select(creditLedger, {
      columns: ["id", "generationId", "createdAt"],
      where: uncostedFailedCall(entryId),
    }),
    db.count(creditLedger, eq(creditLedger.correctsId, entryId)),
  ]);
  const entry = entries.at(0);
  if (entry?.generationId == null || corrections > 0) return undefined;
  return { id: entry.id, generationId: entry.generationId, createdAt: entry.createdAt };
}

/**
 * Records what the gateway billed for the failed call `entryId`: a usage entry for that cost,
 * with the call's role, model, workflow, run, dry-run mark and purpose, at the call's own time,
 * so it counts where the call did. Idempotent: a call already corrected, or an entry that's no
 * uncosted failed call, records nothing and returns undefined. Jobs only.
 */
export async function recordFailedCallCost(
  ctx: Ctx,
  entryId: string,
  costUsd: number,
): Promise<LedgerEntry | undefined> {
  requireSystem(ctx);
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw new ValidationError("A billed cost is zero or more US dollars.");
  }
  const db = forOrg(ctx);
  const call = (await db.select(creditLedger, { where: uncostedFailedCall(entryId) })).at(0);
  if (call === undefined) return undefined;
  const inserted = await db.insert(
    creditLedger,
    {
      id: randomUUID(),
      kind: "usage",
      amount: usageAmount(costUsd),
      role: call.role,
      modelId: call.modelId,
      outcome: "failed",
      costUsd,
      generationId: call.generationId,
      workflowId: call.workflowId,
      runId: call.runId,
      dryRun: call.dryRun,
      purpose: call.purpose,
      correctsId: call.id,
      createdAt: call.createdAt,
    },
    // The unique key on `corrects_id`: a retried or concurrent lookup adds nothing.
    { onConflictDoNothing: true },
  );
  const row = inserted.at(0);
  return row === undefined ? undefined : toEntry(row);
}
