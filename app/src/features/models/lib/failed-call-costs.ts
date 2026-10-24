// Failed calls' real cost (spec #152, "Failed-call costs"). A call that fails is recorded at the
// cost its answer reported, 0 when none did, though the gateway may still bill it. Recording
// such a call, with a generation ID, queues `models/failed-call.recorded`; a few minutes later
// the job looks the generation up and `credits` records what it was billed, as a correction
// with the call's attribution. Calls without a generation ID stay at 0.
import {
  findUncostedFailedCall,
  recordFailedCallCost,
  recordUsage,
  recordUsageIn,
} from "@/features/credits/server";
import type { Usage } from "@/features/credits/types";
import { saveWithEvents } from "@/features/outbox/server";
import { type Ctx, requireSystem } from "@/lib/ctx";
import { DAY_MS, now } from "@/lib/time";
import { failedCallRecorded } from "../events";
import type { FailedCallCostOutcome } from "../types";
import { lookUpGenerationCost } from "./generation-lookup";

/** How long after a failed call its billed cost is looked for, before giving up. */
const LOOKUP_WINDOW_MS = DAY_MS;

/**
 * Records a call's usage entry. A failed call recorded at 0 under a generation ID also queues
 * the lookup of what it was billed.
 */
export async function recordCallUsage(ctx: Ctx, usage: Usage): Promise<void> {
  if (usage.outcome !== "failed" || usage.costUsd !== 0 || usage.generationId === undefined) {
    await recordUsage(ctx, usage);
    return;
  }
  // The entry and its lookup are saved together (ADR-0027). Inngest's event API failing too
  // doesn't replace the call's own error: the outbox job sends the lookup a minute later.
  await saveWithEvents(ctx, async (tx, emit) => {
    const entry = await recordUsageIn(ctx, tx, usage);
    emit(failedCallRecorded, { orgId: ctx.orgId, entryId: entry.id }, `failed-call-${entry.id}`);
  });
}

/**
 * Looks up what the gateway billed for the failed call `entryId` and records it in the ledger,
 * once. Jobs only, as the org's system ctx.
 */
export async function correctFailedCallCost(
  ctx: Ctx,
  entryId: string,
): Promise<FailedCallCostOutcome> {
  requireSystem(ctx);
  const call = await findUncostedFailedCall(ctx, entryId);
  if (call === undefined) return "nothing_to_correct";
  if (now().getTime() - call.createdAt.getTime() > LOOKUP_WINDOW_MS) return "given_up";
  const costUsd = await lookUpGenerationCost(call.generationId);
  if (costUsd === undefined) return "not_billed_yet";
  const correction = await recordFailedCallCost(ctx, call.id, costUsd);
  // Undefined: another attempt recorded it first.
  return correction === undefined ? "nothing_to_correct" : "corrected";
}
