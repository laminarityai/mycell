// Backfilling a connection: record where polling will start, then store the last 90 days page
// by page. Each page is one step, so Inngest retries a failed page without redoing the others.
// A connection deleted while this runs ends it quietly: a missing connection is NotFoundError,
// and a write for it breaks its foreign key.
import { isForeignKeyViolation } from "@/db/errors";
import { getConnection, proxyGet, recordIngestState } from "@/features/connections/server";
import type { Source } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import type { BackfillOutcome } from "../types";
import type { BackfillConnector, SourceClient } from "./connector";
import { gmailConnector } from "./gmail/connector";
import { storeEvents } from "./store";

const BACKFILL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const CONNECTORS: Record<Source, BackfillConnector> = { gmail: gmailConnector };

/** A step result: JSON, since Inngest stores it and replays it instead of re-running. */
type StepResult = Record<string, string | number | boolean | null>;

/**
 * Runs one named step. Inngest's `step.run` in the job; called straight through elsewhere.
 * A step's result must be JSON.
 */
export type RunStep = <T extends StepResult>(id: string, run: () => Promise<T>) => Promise<T>;

const runInline: RunStep = (_id, run) => run();

const CONNECTION_FOREIGN_KEYS = [
  "events_connection_fk",
  "object_refs_connection_fk",
  "object_refs_event_fk",
];

export async function backfillConnection(
  ctx: Ctx,
  connectionId: string,
  runStep: RunStep = runInline,
): Promise<BackfillOutcome> {
  const start = await runStep("start", () => untilGone(() => startBackfill(ctx, connectionId)));
  if (start.gone) return { outcome: "gone" };
  const since = new Date(start.since);
  let progress: PageProgress = { pageToken: null, items: 0 };
  for (let page = 1; page === 1 || progress.pageToken !== null; page++) {
    const from = progress;
    const result: Gone<PageProgress> = await runStep(`page-${String(page)}`, () =>
      untilGone(() => backfillPage(ctx, connectionId, since, from)),
    );
    if (result.gone) return { outcome: "gone" };
    progress = { pageToken: result.pageToken, items: result.items };
  }
  const { items } = progress;
  const end = await runStep("finish", () =>
    untilGone(async () => {
      await recordIngestState(ctx, connectionId, { status: "active", backfilledItems: items });
      return {};
    }),
  );
  return end.gone ? { outcome: "gone" } : { outcome: "done", items };
}

// Where a backfill has got to: the next page to fetch (null after the last), and the messages
// stored so far.
type PageProgress = { pageToken: string | null; items: number };

type Gone<T> = ({ gone: false } & T) | { gone: true };

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

async function backfillPage(
  ctx: Ctx,
  connectionId: string,
  since: Date,
  from: PageProgress,
): Promise<PageProgress> {
  const connection = await getConnection(ctx, connectionId);
  const connector = CONNECTORS[connection.source];
  const page = await connector.backfillPage(sourceClient(ctx, connectionId), since, from.pageToken);
  await storeEvents(ctx, connection, page.events);
  const items = from.items + page.events.length;
  await recordIngestState(ctx, connectionId, { backfilledItems: items });
  return { pageToken: page.nextPageToken, items };
}

function sourceClient(ctx: Ctx, connectionId: string): SourceClient {
  return { get: (path, schema) => proxyGet(ctx, connectionId, path, schema) };
}

// Runs `work`, turning "the connection is gone" into a result instead of an error.
async function untilGone<T extends StepResult>(work: () => Promise<T>): Promise<Gone<T>> {
  try {
    return { gone: false, ...(await work()) };
  } catch (error) {
    if (error instanceof NotFoundError) return { gone: true };
    if (CONNECTION_FOREIGN_KEYS.some((name) => isForeignKeyViolation(error, name))) {
      return { gone: true };
    }
    throw error;
  }
}
