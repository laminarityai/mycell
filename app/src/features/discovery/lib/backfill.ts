// Backfilling a connection: record where polling will start, then store the last 90 days page
// by page. Each page is one step, so Inngest retries a failed page without redoing the others.
// A connection deleted while this runs ends it quietly: a missing connection is NotFoundError,
// and a write for it breaks its foreign key.
import { getConnection, recordIngestState } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import type { BackfillOutcome } from "../types";
import { CONNECTORS, runInline, sourceClient, storeWindow, untilGone } from "./ingest-steps";
import type { RunStep } from "./ingest-steps";

/** How far back a backfill reaches. */
export const BACKFILL_DAYS = 90;
export const DAY_MS = 24 * 60 * 60 * 1000;

export async function backfillConnection(
  ctx: Ctx,
  connectionId: string,
  runStep: RunStep = runInline,
): Promise<BackfillOutcome> {
  const start = await runStep("start", () => untilGone(() => startBackfill(ctx, connectionId)));
  if (start.gone) return { outcome: "gone" };
  const stored = await storeWindow(ctx, connectionId, new Date(start.since), runStep, {
    stepPrefix: "",
    recordProgress: true,
  });
  if (stored.gone) return { outcome: "gone" };
  const { items } = stored;
  const end = await runStep("finish", () =>
    untilGone(async () => {
      await recordIngestState(ctx, connectionId, { status: "active", backfilledItems: items });
      return {};
    }),
  );
  return end.gone ? { outcome: "gone" } : { outcome: "done", items };
}

/** The backfill gave up (Inngest ran out of retries): the connection shows it failed. */
export async function markBackfillFailed(ctx: Ctx, connectionId: string): Promise<void> {
  await untilGone(async () => {
    await recordIngestState(ctx, connectionId, { status: "failed" });
    return {};
  });
}

async function startBackfill(ctx: Ctx, connectionId: string) {
  const connection = await getConnection(ctx, connectionId);
  const connector = CONNECTORS[connection.source];
  // Read before listing, so whatever arrives during the backfill is polled after it.
  const cursor = await connector.readStartCursor(sourceClient(ctx, connectionId));
  await recordIngestState(ctx, connectionId, { status: "backfilling", backfilledItems: 0, cursor });
  return { since: new Date(Date.now() - BACKFILL_DAYS * DAY_MS).toISOString() };
}
