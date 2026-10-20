// What backfilling and polling share: the connectors, steps, storing a time window page by page,
// and treating a connection that's gone as the end of the job rather than an error.
import { isForeignKeyViolation } from "@/db/errors";
import { getConnection, proxyGet, recordIngestState } from "@/features/connections/server";
import type { IngestedApp } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import type { Connector, SourceClient } from "./connector";
import { driveConnector } from "./drive/connector";
import { gmailConnector } from "./gmail/connector";
import { storeEvents } from "./store";

/** The connector for each app discovery ingests. One connection may run several. */
export const CONNECTORS: Record<IngestedApp, Connector> = {
  gmail: gmailConnector,
  drive: driveConnector,
};

/** A step result: JSON, since Inngest stores it and replays it instead of re-running. */
export type StepResult = Record<string, string | number | boolean | null | string[]>;

/**
 * Runs one named step. Inngest's `step.run` in the job; called straight through elsewhere.
 * A step's result must be JSON.
 */
export type RunStep = <T extends StepResult>(id: string, run: () => Promise<T>) => Promise<T>;

export const runInline: RunStep = (_id, run) => run();

/** A step's result, or that the connection was gone. */
export type Gone<T> = ({ gone: false } & T) | { gone: true };

const CONNECTION_FOREIGN_KEYS = [
  "events_connection_fk",
  "object_refs_connection_fk",
  "object_refs_event_fk",
];

/**
 * Runs `work`, turning "the connection is gone" into a result instead of an error: a missing
 * connection (or app on it) is NotFoundError, and a write for one breaks its foreign key.
 */
export async function untilGone<T extends StepResult>(work: () => Promise<T>): Promise<Gone<T>> {
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

export function sourceClient(ctx: Ctx, connectionId: string): SourceClient {
  return { get: (path, schema) => proxyGet(ctx, connectionId, path, schema) };
}

/**
 * Stores everything that occurred in one app since `since`, one page per step named
 * `<stepPrefix>page-<n>`. With `recordProgress`, the app's ingest state shows the running
 * count (the backfill's progress). Returns how many items it stored.
 */
export async function storeWindow(
  ctx: Ctx,
  connectionId: string,
  app: IngestedApp,
  since: Date,
  runStep: RunStep,
  options: { stepPrefix: string; recordProgress: boolean },
): Promise<Gone<{ items: number }>> {
  let progress: PageProgress = { pageToken: null, items: 0 };
  for (let page = 1; page === 1 || progress.pageToken !== null; page++) {
    const from = progress;
    const result: Gone<PageProgress> = await runStep(
      `${options.stepPrefix}page-${String(page)}`,
      () =>
        untilGone(() => storePage(ctx, { connectionId, app, since, from }, options.recordProgress)),
    );
    if (result.gone) return { gone: true };
    progress = { pageToken: result.pageToken, items: result.items };
  }
  return { gone: false, items: progress.items };
}

// Where a window has got to: the next page to fetch (null after the last), and the items
// stored so far.
type PageProgress = { pageToken: string | null; items: number };

type PageRequest = { connectionId: string; app: IngestedApp; since: Date; from: PageProgress };

async function storePage(
  ctx: Ctx,
  { connectionId, app, since, from }: PageRequest,
  recordProgress: boolean,
): Promise<PageProgress> {
  const connection = await getConnection(ctx, connectionId);
  const page = await CONNECTORS[app].backfillPage(
    sourceClient(ctx, connectionId),
    since,
    from.pageToken,
  );
  await storeEvents(ctx, connection, app, page.events);
  const items = from.items + page.events.length;
  if (recordProgress) {
    await recordIngestState(ctx, connectionId, app, { backfilledItems: items });
  }
  return { pageToken: page.nextPageToken, items };
}
