// What backfilling and polling share: the connectors, steps, storing a time window page by page,
// and treating a connection that's gone as the end of the job rather than an error.
import { recordIngestState, sourceClient } from "@/features/connections/server";
import type { IngestedApp } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { untilGone, type RunStep } from "@/lib/inngest";
import {
  announcedFor,
  sendAnnounced,
  type Announced,
  type Changes,
  type Received,
  type Sent,
  type Stored,
} from "./announce";
import type { Connector } from "./connector";
import { driveConnector } from "./drive/connector";
import { gmailConnector } from "./gmail/connector";
import { storeEvents } from "./store";

/** The connector for each app discovery ingests. One connection may run several. */
export const CONNECTORS: Record<IngestedApp, Connector> = {
  gmail: gmailConnector,
  drive: driveConnector,
};

type StepValue =
  string | number | boolean | null | string[] | Received[] | Sent[] | Stored[] | Changes;

/** A step result: JSON, since Inngest stores it and replays it instead of re-running. */
export type StepResult = Record<string, StepValue>;

/** A step's result, or that the connection was gone. */
export type Gone<T> = ({ gone: false } & T) | { gone: true };

const CONNECTION_FOREIGN_KEYS = [
  "events_connection_fk",
  "object_refs_connection_fk",
  "object_refs_event_fk",
];

/** Runs `work`, turning "the connection is gone" into a result instead of an error. */
export function whileConnected<T extends StepResult>(work: () => Promise<T>): Promise<Gone<T>> {
  return untilGone(
    CONNECTION_FOREIGN_KEYS,
    async (): Promise<Gone<T>> => ({ gone: false, ...(await work()) }),
    { gone: true },
  );
}

/**
 * Stores everything that occurred in one app since `since`, one page per step named
 * `<stepPrefix>page-<n>`. With `recordProgress`, the app's ingest state shows the running
 * count (the backfill's progress). Each page's new Gmail messages and Drive file versions are
 * sent on as discovery/item.stored, and with `announce` (a recovery's) also as
 * discovery/gmail.message_received (inbound) and discovery/gmail.message_sent (sent), in a step
 * after the page's (`<stepPrefix>page-<n>-announce`). Returns how many items it stored.
 */
export async function storeWindow(
  ctx: Ctx,
  connectionId: string,
  app: IngestedApp,
  since: Date,
  runStep: RunStep,
  options: WindowOptions,
): Promise<Gone<{ items: number }>> {
  let progress: PageProgress = { pageToken: null, items: 0 };
  for (let page = 1; page === 1 || progress.pageToken !== null; page++) {
    const from = progress;
    const result: Gone<StoredPage> = await runStep(
      `${options.stepPrefix}page-${String(page)}`,
      () => whileConnected(() => storePage(ctx, { connectionId, app, since, from }, options)),
    );
    if (result.gone) return { gone: true };
    const announceId = `${options.stepPrefix}page-${String(page)}-announce`;
    await sendAnnounced(ctx, connectionId, app, result, runStep, announceId);
    progress = { pageToken: result.pageToken, items: result.items };
  }
  return { gone: false, items: progress.items };
}

// Where a window has got to: the next page to fetch (null after the last), and the items
// stored so far.
type PageProgress = { pageToken: string | null; items: number };

// A stored page: where the window has got to, and what to announce (when it announces).
type StoredPage = PageProgress & Announced;

type WindowOptions = { stepPrefix: string; recordProgress: boolean; announce: boolean };

type PageRequest = { connectionId: string; app: IngestedApp; since: Date; from: PageProgress };

async function storePage(
  ctx: Ctx,
  { connectionId, app, since, from }: PageRequest,
  { recordProgress, announce }: WindowOptions,
): Promise<StoredPage> {
  // The connection is read once for the page, not once per message the page fetches.
  const client = await sourceClient(ctx, connectionId);
  const page = await CONNECTORS[app].backfillPage(client, since, from.pageToken);
  const created = await storeEvents(ctx, client.connection, app, page.events);
  const announced = announcedFor(app, created, { newMail: announce });
  const items = from.items + page.events.length;
  if (recordProgress) {
    await recordIngestState(ctx, connectionId, app, { backfilledItems: items });
  }
  return { pageToken: page.nextPageToken, items, ...announced };
}
