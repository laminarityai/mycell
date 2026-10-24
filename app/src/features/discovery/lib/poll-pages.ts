// Reading one app's changes since its cursor in steps: one per page of the source's listing
// (Gmail's history, Drive's changes feed), then one per batch of the items the pages listed by
// ID only (Gmail's messages added), so no step's work grows with the mailbox or the Drive, and a
// retry after a crash goes on from the last finished step. Each step hands on IDs and pointers
// only, never content.
//
// A page step stores what its page found at once (Drive's files), and a batch step what it read
// (Gmail's messages). A batch's new messages are announced right after it, as the backfill's
// pages are, since every page has been read by then and nothing later in the listing can remove
// them. What the pages stored is announced once they've all been read and the cursor recorded,
// with what they found removed or changed, as one poll found it: a file a later page reports
// removed isn't announced as stored, and a removal a later page undoes isn't announced.
import { getConnection, recordIngestState, sourceClient } from "@/features/connections/server";
import type { IngestedApp } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { InvariantError } from "@/lib/errors";
import type { RunStep } from "@/lib/inngest";
import {
  announcedFor,
  changesOf,
  sendAnnounced,
  type Announced,
  type Received,
  type Sent,
  type Stored,
} from "./announce";
import { CONNECTORS, whileConnected, type Gone } from "./ingest-steps";
import { storeEvents } from "./store";

// Items a batch step reads: a backfill page's worth (Gmail's backfill pages hold 100 messages),
// so a batch, like a page, stays well inside one Inngest step.
const READ_BATCH = 100;

/** How reading an app's changes ended: polled, with the items read; or why not. */
export type ChangesRead =
  | { outcome: "polled"; items: number }
  | { outcome: "skipped" }
  | { outcome: "gone" }
  | { outcome: "expired" };

/**
 * Reads, stores and announces everything new in one app since its cursor, records the next
 * cursor, and announces what's gone or changed. Steps are named `<app>-poll-page-<n>`,
 * `<app>-poll-fetch-<n>` (with `-announce` after each), `<app>-poll-finish` and
 * `<app>-poll-announce`. An app not due is `skipped`; one whose cursor the source no longer
 * knows is `expired`, after announcing what pages before that stored.
 */
export async function readChanges(
  ctx: Ctx,
  connectionId: string,
  app: IngestedApp,
  runStep: RunStep,
): Promise<ChangesRead> {
  const pages: PageRead[] = [];
  for (let n = 1; ; n++) {
    const from = pages.at(-1) ?? null;
    const page: Gone<PageStep> = await runStep(`${app}-poll-page-${String(n)}`, () =>
      whileConnected(() => readPage(ctx, connectionId, app, from)),
    );
    if (page.gone) return { outcome: "gone" };
    if (page.result === "skipped") return { outcome: "skipped" };
    if (page.result === "expired") {
      const before = merged(pages);
      if (before !== null) {
        await sendAnnounced(ctx, connectionId, app, before.announced, runStep, announceStepId(app));
      }
      return { outcome: "expired" };
    }
    pages.push(page);
    if (page.nextPageToken === null) break;
  }
  const read = merged(pages);
  if (read?.nextCursor === undefined) {
    throw new InvariantError(`The ${app} poll's pages named no cursor to go on from`);
  }
  const { added, announced, nextCursor } = read;
  let items = read.items;
  for (let n = 1; (n - 1) * READ_BATCH < added.length; n++) {
    const ids = added.slice((n - 1) * READ_BATCH, n * READ_BATCH);
    const id = `${app}-poll-fetch-${String(n)}`;
    const batch = await runStep(id, () =>
      whileConnected(() => readBatch(ctx, connectionId, app, ids)),
    );
    if (batch.gone) return { outcome: "gone" };
    await sendAnnounced(ctx, connectionId, app, batch, runStep, `${id}-announce`);
    items += batch.items;
  }
  const end = await runStep(`${app}-poll-finish`, () =>
    whileConnected(async () => {
      await recordIngestState(ctx, connectionId, app, {
        cursor: nextCursor,
        lastPolledAt: new Date(),
      });
      return {};
    }),
  );
  if (end.gone) return { outcome: "gone" };
  await sendAnnounced(ctx, connectionId, app, announced, runStep, announceStepId(app));
  return { outcome: "polled", items };
}

// The step announcing what the pages stored, found changed or found removed.
const announceStepId = (app: IngestedApp) => `${app}-poll-announce`;

// A page as its step hands it on: the cursor the poll reads from, what the page stored as
// pointers, the IDs it listed as added or removed, the refs it found stored already, and where
// the listing goes on.
type PageRead = {
  result: "page";
  cursor: string;
  received: Received[];
  sent: Sent[];
  stored: Stored[];
  changed: string[];
  added: string[];
  removed: string[];
  items: number;
  nextPageToken: string | null;
  nextCursor: string | null;
};

type PageStep = PageRead | { result: "skipped" } | { result: "expired" };

// One page: the first reads the app's cursor, and whether it's due at all; each later one goes
// on from the page before.
async function readPage(
  ctx: Ctx,
  connectionId: string,
  app: IngestedApp,
  from: PageRead | null,
): Promise<PageStep> {
  let cursor: string;
  if (from === null) {
    const connection = await getConnection(ctx, connectionId);
    const state = connection.ingest[app];
    if (connection.needsReauth || state?.status !== "active") return { result: "skipped" };
    if (state.cursor === null) return { result: "expired" };
    cursor = state.cursor;
  } else {
    cursor = from.cursor;
  }
  const client = await sourceClient(ctx, connectionId);
  const page = await CONNECTORS[app].pollPage(client, cursor, from?.nextPageToken ?? null);
  if ("cursorExpired" in page) return { result: "expired" };
  const created = await storeEvents(ctx, client.connection, app, page.events);
  const { received, sent, stored } = announcedFor(app, created, { newMail: true });
  const { removed, changed } = changesOf(app, cursor, page, created);
  return {
    result: "page",
    cursor,
    received,
    sent,
    stored,
    changed,
    added: page.added,
    removed,
    items: page.events.length,
    nextPageToken: page.nextPageToken,
    nextCursor: page.nextCursor,
  };
}

// One batch of the items the pages listed as added: read, normalized and stored.
async function readBatch(ctx: Ctx, connectionId: string, app: IngestedApp, ids: string[]) {
  const connector = CONNECTORS[app];
  if (connector.readAdded === undefined) {
    throw new InvariantError(`The ${app} connector listed items to read but can't read them`);
  }
  // The connection is read once for the batch, not once per item.
  const client = await sourceClient(ctx, connectionId);
  const events = await connector.readAdded(client, ids);
  const created = await storeEvents(ctx, client.connection, app, events);
  return { items: events.length, ...announcedFor(app, created, { newMail: true }) };
}

// The pages as one poll's reading, or null before any: the IDs listed as added, once each in
// order; what the pages stored and found changed or removed, as the listing ends with it; how
// many items they found; and the first cursor a page named.
function merged(pages: PageRead[]) {
  if (pages.length === 0) return null;
  const added = new Set<string>();
  const removed = new Set<string>();
  let received: Received[] = [];
  let sent: Sent[] = [];
  let stored: Stored[] = [];
  let changed: string[] = [];
  for (const page of pages) {
    const found = [...page.received, ...page.sent, ...page.stored].map((item) => item.sourceRef);
    // Back after a removal on an earlier page.
    for (const ref of [...found, ...page.changed]) removed.delete(itemIdOf(ref));
    received = [...received, ...page.received];
    sent = [...sent, ...page.sent];
    stored = [...stored, ...page.stored];
    changed = [...changed, ...page.changed];
    for (const itemId of page.removed) {
      // Gone after a version an earlier page found: none of its versions is announced.
      const kept = (ref: string) => itemIdOf(ref) !== itemId;
      received = received.filter((item) => kept(item.sourceRef));
      sent = sent.filter((item) => kept(item.sourceRef));
      stored = stored.filter((item) => kept(item.sourceRef));
      changed = changed.filter(kept);
      removed.add(itemId);
    }
    for (const id of page.added) added.add(id);
  }
  const changes = { cursor: pages[0].cursor, removed: [...removed], changed };
  const announced: Announced = { received, sent, stored, changes };
  return {
    added: [...added],
    announced,
    items: pages.reduce((sum, page) => sum + page.items, 0),
    nextCursor: pages.find((page) => page.nextCursor !== null)?.nextCursor ?? undefined,
  };
}

// The item a source_ref is a version of: a Drive file version's ref is `<file ID>@<version>`,
// and a Gmail message's ref is its ID.
function itemIdOf(sourceRef: string): string {
  return sourceRef.split("@")[0];
}
