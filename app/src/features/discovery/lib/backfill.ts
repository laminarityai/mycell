// Backfilling a connection: for each app still backfilling on it (on a new connection, every
// ingested app it was granted; after a reconnect, the ones it newly allows and any whose
// backfill failed), record where polling will start, then store the last 90 days page by page.
// Each page is one step, so Inngest retries a failed page without redoing the others. A
// connection deleted while this runs ends it quietly: a missing connection is NotFoundError,
// and a write for it breaks its foreign key. Finishing sets only the app's ingest status, so a
// `needs_reauth` Nango reported meanwhile (kept on the connection itself) stays. An app that can
// watch then starts its watch, in a step of its own (ADR-0026); a failure leaves it to polling.
import { getConnection, recordIngestState, sourceClient } from "@/features/connections/server";
import { ingestedAppSchema, type IngestedApp } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { runInline, type RunStep } from "@/lib/inngest";
import { DAY_MS, now } from "@/lib/time";
import type { BackfillOutcome } from "../types";
import { CONNECTORS, storeWindow, whileConnected } from "./ingest-steps";
import { startWatch, watches } from "./watch";

/** How far back a backfill reaches. */
export const BACKFILL_DAYS = 90;

export async function backfillConnection(
  ctx: Ctx,
  connectionId: string,
  runStep: RunStep = runInline,
): Promise<BackfillOutcome> {
  const start = await runStep("start", () =>
    whileConnected(() => startBackfill(ctx, connectionId)),
  );
  if (start.gone) return { outcome: "gone" };
  let items = 0;
  for (const app of start.apps) {
    const stored = await storeWindow(ctx, connectionId, app, new Date(start.since), runStep, {
      stepPrefix: `${app}-`,
      recordProgress: true,
      // A backfill reads history: nothing it stores is new mail to run workflows on.
      announce: false,
    });
    if (stored.gone) return { outcome: "gone" };
    const end = await runStep(`${app}-finish`, () =>
      whileConnected(async () => {
        await recordIngestState(ctx, connectionId, app, {
          status: "active",
          backfilledItems: stored.items,
        });
        return {};
      }),
    );
    if (end.gone) return { outcome: "gone" };
    if (watches(app)) {
      const watched = await runStep(`${app}-watch`, () =>
        whileConnected(async () => {
          const expiresAt = await startWatch(ctx, connectionId, app);
          return { expiresAt: expiresAt?.toISOString() ?? null };
        }),
      );
      if (watched.gone) return { outcome: "gone" };
    }
    items += stored.items;
  }
  return { outcome: "done", items };
}

/** The backfill gave up (Inngest ran out of retries): each app it hadn't finished failed. */
export async function markBackfillFailed(ctx: Ctx, connectionId: string): Promise<void> {
  await whileConnected(async () => {
    for (const app of await backfillingApps(ctx, connectionId)) {
      await recordIngestState(ctx, connectionId, app, { status: "failed" });
    }
    return {};
  });
}

async function startBackfill(ctx: Ctx, connectionId: string) {
  const apps = await backfillingApps(ctx, connectionId);
  const client = await sourceClient(ctx, connectionId);
  for (const app of apps) {
    // Read before listing, so whatever arrives during the backfill is polled after it.
    const cursor = await CONNECTORS[app].readStartCursor(client);
    await recordIngestState(ctx, connectionId, app, { backfilledItems: 0, cursor });
  }
  return { apps, since: new Date(now().getTime() - BACKFILL_DAYS * DAY_MS).toISOString() };
}

async function backfillingApps(ctx: Ctx, connectionId: string): Promise<IngestedApp[]> {
  const { ingest } = await getConnection(ctx, connectionId);
  return ingestedAppSchema.options.filter((app) => ingest[app]?.status === "backfilling");
}
