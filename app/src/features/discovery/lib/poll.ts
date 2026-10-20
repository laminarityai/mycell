// Polling a connection: everything new since its cursor, normalized and stored exactly as the
// backfill stores it, then the next cursor. Re-running a poll stores nothing twice (events are
// unique per connection on source_ref). Only `active` connections are polled: one still
// backfilling has its cursor taken care of by the backfill, and one needing a reconnect can't
// reach its source.
//
// An expired cursor recovers inline, in the same run: it records a fresh start cursor, then
// backfills from just before the latest stored event, one page per step, and only then stores
// the new cursor. Running it here rather than re-triggering the backfill job keeps it inside the
// poll's per-connection concurrency slot (so no backfill or other poll races it), needs no
// second event or trigger for the backfill job, leaves the connection `active` instead of
// showing a fresh 90-day backfill, and a recovery that fails part-way leaves the expired cursor
// in place, so the next poll simply recovers again.
import { getConnection, recordIngestState } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import type { PollOutcome } from "../types";
import { BACKFILL_DAYS, DAY_MS } from "./backfill";
import { CONNECTORS, runInline, sourceClient, storeWindow, untilGone } from "./ingest-steps";
import type { RunStep } from "./ingest-steps";
import { latestEventTime, storeEvents } from "./store";

// How far before the latest stored event a recovery starts, for messages Gmail dates a little
// earlier than one already stored. What it re-reads is stored once.
const RECOVERY_OVERLAP_MS = DAY_MS;

export async function pollConnection(
  ctx: Ctx,
  connectionId: string,
  runStep: RunStep = runInline,
): Promise<PollOutcome> {
  const polled = await runStep("poll", () => untilGone(() => pollOnce(ctx, connectionId)));
  if (polled.gone) return { outcome: "gone" };
  if (polled.result === "skipped") return { outcome: "skipped" };
  if (polled.result === "polled") return { outcome: "polled", items: polled.items };
  return recover(ctx, connectionId, runStep);
}

async function pollOnce(ctx: Ctx, connectionId: string) {
  const connection = await getConnection(ctx, connectionId);
  if (connection.status !== "active") return { result: "skipped", items: 0 } as const;
  if (connection.cursor === null) return { result: "expired", items: 0 } as const;
  const connector = CONNECTORS[connection.source];
  const found = await connector.poll(sourceClient(ctx, connectionId), connection.cursor);
  if ("cursorExpired" in found) return { result: "expired", items: 0 } as const;
  await storeEvents(ctx, connection, found.events);
  await recordIngestState(ctx, connectionId, {
    cursor: found.nextCursor,
    lastPolledAt: new Date(),
  });
  return { result: "polled", items: found.events.length } as const;
}

// The source no longer knows the cursor: backfill from the latest stored event, then poll on
// from a cursor read before that backfill.
async function recover(ctx: Ctx, connectionId: string, runStep: RunStep): Promise<PollOutcome> {
  const start = await runStep("recover-start", () =>
    untilGone(async () => {
      const connection = await getConnection(ctx, connectionId);
      const connector = CONNECTORS[connection.source];
      // Read before listing, like the backfill, so nothing arriving meanwhile is missed.
      const cursor = await connector.readStartCursor(sourceClient(ctx, connectionId));
      const since = recoverySince(await latestEventTime(ctx, connectionId));
      return { cursor, since: since.toISOString() };
    }),
  );
  if (start.gone) return { outcome: "gone" };
  const stored = await storeWindow(ctx, connectionId, new Date(start.since), runStep, {
    stepPrefix: "recover-",
    recordProgress: false,
  });
  if (stored.gone) return { outcome: "gone" };
  const { cursor } = start;
  const end = await runStep("recover-finish", () =>
    untilGone(async () => {
      await recordIngestState(ctx, connectionId, { cursor, lastPolledAt: new Date() });
      return {};
    }),
  );
  return end.gone ? { outcome: "gone" } : { outcome: "recovered", items: stored.items };
}

// Just before the latest stored event, but never further back than a backfill reaches.
function recoverySince(latest: Date | null): Date {
  const windowStart = Date.now() - BACKFILL_DAYS * DAY_MS;
  if (latest === null) return new Date(windowStart);
  return new Date(Math.max(latest.getTime() - RECOVERY_OVERLAP_MS, windowStart));
}
