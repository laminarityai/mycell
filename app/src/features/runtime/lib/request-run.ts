// Asking for a run to execute: `runtime/run.requested`, emitted through the outbox with the
// change that records the run (ADR-0027), or on its own for a run recorded already.
import type { Emit } from "@/features/outbox/types";
import type { Ctx } from "@/lib/ctx";
import { runRequested } from "../events";

/**
 * Emits the run's request. Its event ID, `run-<run ID>`, makes Inngest execute the run once
 * however often it's requested: by the fan-out again, by a second click on Retry, or by the
 * outbox job after the send right after the commit failed.
 */
export function requestRun(ctx: Ctx, emit: Emit, run: { id: string; connectionId: string }) {
  emit(
    runRequested,
    { orgId: ctx.orgId, runId: run.id, connectionId: run.connectionId },
    `run-${run.id}`,
  );
}
