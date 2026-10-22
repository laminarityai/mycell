// Polling a connection: for each of its apps, everything new since that app's cursor,
// normalized and stored exactly as the backfill stores it, then the app's next cursor.
// Re-running a poll stores nothing twice (events are unique per connection on source_ref).
// Only `active` apps are polled: one still backfilling has its cursor taken care of by the
// backfill. A connection needing a reconnect can't reach its source, so it's skipped whole.
//
// An expired cursor recovers inline, in the same run: it records a fresh start cursor, then
// backfills the app from just before the latest stored event, one page per step, and only then
// stores the new cursor. Running it here rather than re-triggering the backfill job keeps it
// inside the poll's per-connection concurrency slot (so no backfill or other poll races it),
// needs no second event or trigger for the backfill job, leaves the app `active` instead of
// showing a fresh 90-day backfill, and a recovery that fails part-way leaves the expired cursor
// in place, so the next poll simply recovers again.
import { getConnection, recordIngestState } from "@/features/connections/server";
import { ingestedAppSchema, type IngestedApp } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import type { PollOutcome } from "../types";
import { announcedFor, sendAnnounced, NOTHING, type Announced } from "./announce";
import { BACKFILL_DAYS, DAY_MS } from "./backfill";
import { CONNECTORS, runInline, sourceClient, storeWindow, untilGone } from "./ingest-steps";
import type { RunStep } from "./ingest-steps";
import { latestEventTime, storeEvents } from "./store";

// How far before the latest stored event a recovery starts, for messages Gmail dates a little
// earlier than one already stored. What it re-reads is stored once.
const RECOVERY_OVERLAP_MS = DAY_MS;

// How one app's poll ended.
type AppPoll = { outcome: "polled" | "recovered"; items: number } | { outcome: "skipped" | "gone" };

/**
 * Polls each of the connection's apps in turn. It was `polled` if any app was (`recovered` if
 * any recovered from an expired cursor), with the items read across apps; `skipped` if no app
 * was due; `gone` if the connection was deleted while it ran.
 */
export async function pollConnection(
  ctx: Ctx,
  connectionId: string,
  runStep: RunStep = runInline,
): Promise<PollOutcome> {
  const polls: AppPoll[] = [];
  for (const app of ingestedAppSchema.options) {
    const poll = await pollApp(ctx, connectionId, app, runStep);
    if (poll.outcome === "gone") return { outcome: "gone" };
    polls.push(poll);
  }
  const ran = polls.flatMap((poll) => (poll.outcome === "skipped" ? [] : [poll]));
  if (ran.length === 0) return { outcome: "skipped" };
  return {
    outcome: ran.some((poll) => poll.outcome === "recovered") ? "recovered" : "polled",
    items: ran.reduce((sum, poll) => sum + ("items" in poll ? poll.items : 0), 0),
  };
}

async function pollApp(
  ctx: Ctx,
  connectionId: string,
  app: IngestedApp,
  runStep: RunStep,
): Promise<AppPoll> {
  const polled = await runStep(`${app}-poll`, () =>
    untilGone(() => pollOnce(ctx, connectionId, app)),
  );
  if (polled.gone) return { outcome: "gone" };
  if (polled.result === "skipped") return { outcome: "skipped" };
  if (polled.result === "polled") {
    await sendAnnounced(ctx, connectionId, app, polled, runStep, `${app}-poll-announce`);
    return { outcome: "polled", items: polled.items };
  }
  return recover(ctx, connectionId, app, runStep);
}

type PollOnce = { result: "skipped" | "expired" | "polled"; items: number } & Announced;

// Stores what's new, and hands on what it newly stored (Gmail messages, received and sent, and
// Drive file versions) for the step after it to announce.
async function pollOnce(ctx: Ctx, connectionId: string, app: IngestedApp): Promise<PollOnce> {
  const connection = await getConnection(ctx, connectionId);
  const state = connection.ingest[app];
  if (connection.needsReauth || state?.status !== "active") {
    return { result: "skipped", items: 0, ...NOTHING };
  }
  if (state.cursor === null) return { result: "expired", items: 0, ...NOTHING };
  const found = await CONNECTORS[app].poll(sourceClient(ctx, connectionId), state.cursor);
  if ("cursorExpired" in found) return { result: "expired", items: 0, ...NOTHING };
  const created = await storeEvents(ctx, connection, app, found.events);
  await recordIngestState(ctx, connectionId, app, {
    cursor: found.nextCursor,
    lastPolledAt: new Date(),
  });
  const announced = announcedFor(app, created, { newMail: true });
  return { result: "polled", items: found.events.length, ...announced };
}

// The source no longer knows the app's cursor: backfill the app from the latest stored event,
// then poll on from a cursor read before that backfill.
async function recover(
  ctx: Ctx,
  connectionId: string,
  app: IngestedApp,
  runStep: RunStep,
): Promise<AppPoll> {
  const start = await runStep(`${app}-recover-start`, () =>
    untilGone(async () => {
      // Read before listing, like the backfill, so nothing arriving meanwhile is missed.
      const cursor = await CONNECTORS[app].readStartCursor(sourceClient(ctx, connectionId));
      const since = recoverySince(await latestEventTime(ctx, connectionId, app));
      return { cursor, since: since.toISOString() };
    }),
  );
  if (start.gone) return { outcome: "gone" };
  const stored = await storeWindow(ctx, connectionId, app, new Date(start.since), runStep, {
    stepPrefix: `${app}-recover-`,
    recordProgress: false,
    announce: true,
  });
  if (stored.gone) return { outcome: "gone" };
  const { cursor } = start;
  const end = await runStep(`${app}-recover-finish`, () =>
    untilGone(async () => {
      await recordIngestState(ctx, connectionId, app, { cursor, lastPolledAt: new Date() });
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
