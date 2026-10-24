// Following each app's deletions and access changes (ADR-0023, ADR-0024), as the org's system
// ctx (ADR-0009). An item gone from a connection's app (discovery's `discovery/item.removed`, the
// Calendar poll's `calendar/event.removed`) deletes that connection's source records of it, and
// migration 0026's triggers then delete the facts left with no source and the objects left with
// no facts, in the same statement. A Drive file or Calendar event changed in place
// (`discovery/item.changed`, `calendar/event.changed`) has its sharing list or guests read again,
// and its records' access lists rewritten from them; one the app no longer gives the account goes
// as if removed. Every night, each Drive file and Calendar event memory learned from is read
// again the same way, as a backstop for a change the feed missed (a Calendar sync token that
// expired, say). Gmail messages never change who is on them, so only their deletions are followed.
import { and, asc, eq, gt, inArray, lte, sql, type SQL } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { sourceClient } from "@/features/connections/server";
import type { SourceClient } from "@/features/connections/types";
import { type Ctx, requireSystem } from "@/lib/ctx";
import { runInline, untilGone, type RunStep } from "@/lib/inngest";
import { now as clockNow } from "@/lib/time";
import type { AccessReread, ChangedItem, MemoryApp, RemovedItem } from "../types";
import { calendarVersion, readInviteAccess } from "./calendar";
import { driveVersion, readAccess } from "./drive";
import { accessListEntries, sourceRecords } from "./schema";
import { accessRows, type AccessEntry } from "./source-item";

// Source records per nightly step: each needs one files.get or events.get.
const REREAD_BATCH = 100;

// The apps whose items change who may see them, and how one is named: a Drive file by its ID, a
// Calendar event by its event ID.
type Followed = Exclude<MemoryApp, "gmail">;
const FOLLOWED: Followed[] = ["drive", "calendar"];

/**
 * Deletes the connection's source records of an item gone from its app: a Gmail message by its
 * ID, every version of a Drive file by the file's ID, or every version of a Calendar event by
 * its event ID. Facts only they supported go with them. Returns how many records went.
 */
export async function deleteRemovedItem(ctx: Ctx, item: RemovedItem): Promise<{ records: number }> {
  requireSystem(ctx);
  const records = await forOrg(ctx).deleteCount(
    sourceRecords,
    and(
      eq(sourceRecords.connectionId, item.connectionId),
      eq(sourceRecords.app, item.app),
      item.app === "gmail"
        ? eq(sourceRecords.sourceRef, item.itemId)
        : sameItem(item.app, item.itemId),
    ),
  );
  return { records };
}

/**
 * Reads again who may see a Drive file or Calendar event changed in place, and rewrites what
 * memory keeps.
 */
export async function rereadAccess(ctx: Ctx, item: ChangedItem): Promise<AccessReread> {
  requireSystem(ctx);
  return reread(
    ctx,
    sourcesOf(ctx),
    item.connectionId,
    item.app,
    itemIdOf(item.app, item.sourceRef),
  );
}

/**
 * The nightly backstop: reads again who may see each Drive file and Calendar event memory
 * learned from and hasn't re-read since this run began, a batch of records per step. Returns
 * how many items it read and how many of those their app no longer gave their connection's
 * account.
 */
export async function rereadAllAccess(
  ctx: Ctx,
  runStep: RunStep = runInline,
): Promise<{ items: number; removed: number }> {
  requireSystem(ctx);
  const { startedAt } = await runStep("start", () =>
    Promise.resolve({ startedAt: clockNow().toISOString() }),
  );
  const totals = { items: 0, removed: 0 };
  let after: string | null = null;
  for (let batch = 0; ; batch += 1) {
    const done: Batch = await runStep(`reread-${String(batch)}`, () =>
      rereadBatch(ctx, new Date(startedAt), after),
    );
    totals.items += done.items;
    totals.removed += done.removed;
    if (done.next === null) return totals;
    after = done.next;
  }
}

type Batch = { items: number; removed: number; next: string | null };

// The next batch of Drive and Calendar records by ID, after `after`, not re-read since
// `checkedBefore`.
async function rereadBatch(ctx: Ctx, checkedBefore: Date, after: string | null): Promise<Batch> {
  const db = forOrg(ctx);
  const records = await db.select(sourceRecords, {
    where: and(
      inArray(sourceRecords.app, FOLLOWED),
      lte(sourceRecords.accessCheckedAt, checkedBefore),
      after === null ? undefined : gt(sourceRecords.id, after),
    ),
    orderBy: [asc(sourceRecords.id)],
    limit: REREAD_BATCH,
  });
  const seen = new Set<string>();
  const sources = sourcesOf(ctx);
  const done: Batch = { items: 0, removed: 0, next: null };
  for (const record of records) {
    if (record.app === "gmail") continue;
    // A connection's records of one item are re-read together.
    const itemId = itemIdOf(record.app, record.sourceRef);
    const item = `${record.connectionId}\n${record.app}\n${itemId}`;
    if (seen.has(item)) continue;
    seen.add(item);
    const { outcome } = await reread(ctx, sources, record.connectionId, record.app, itemId);
    if (outcome === "rewritten" || outcome === "removed") done.items += 1;
    if (outcome === "removed") done.removed += 1;
  }
  const last = records.at(-1);
  return { ...done, next: records.length < REREAD_BATCH || last === undefined ? null : last.id };
}

// Each connection's source, opened (its access checked) the first time a step needs it.
type Sources = (connectionId: string) => Promise<SourceClient>;

function sourcesOf(ctx: Ctx): Sources {
  const opened = new Map<string, Promise<SourceClient>>();
  return (connectionId) => {
    const source = opened.get(connectionId) ?? sourceClient(ctx, connectionId);
    opened.set(connectionId, source);
    return source;
  };
}

const CONNECTION_FOREIGN_KEYS = [
  "access_list_entries_connection_fk",
  "access_list_entries_source_record_fk",
];

// The ID of the item a Drive or Calendar `source_ref` is a version of.
function itemIdOf(app: Followed, sourceRef: string): string {
  return app === "drive" ? driveVersion(sourceRef).fileId : calendarVersion(sourceRef).eventId;
}

// SQL: a connection's records of every version of the item: a Drive file's by its item key (the
// file ID), a Calendar event's by its `source_ref`'s event ID (an invite's item key is its
// iCalUID, which the app's change feed doesn't give).
function sameItem(app: Followed, itemId: string): SQL {
  return app === "drive"
    ? eq(sourceRecords.itemKey, itemId)
    : sql`starts_with(${sourceRecords.sourceRef}, ${`${itemId}@`})`;
}

// Reads who may see the item through the connection, and rewrites the access lists of the
// connection's records of it, or deletes them when the app no longer gives the account the item.
async function reread(
  ctx: Ctx,
  sources: Sources,
  connectionId: string,
  app: Followed,
  itemId: string,
): Promise<AccessReread> {
  const db = forOrg(ctx);
  const records = await db.select(sourceRecords, {
    columns: ["id"],
    where: and(
      eq(sourceRecords.connectionId, connectionId),
      eq(sourceRecords.app, app),
      sameItem(app, itemId),
    ),
  });
  // Memory learned nothing from it: a file that isn't a Google Doc, or an event with no guests.
  if (records.length === 0) return { outcome: "unknown" };
  const ids = records.map((record) => record.id);
  // The connection went meanwhile, and its records with it.
  const work = async () => rewrite(ctx, await sources(connectionId), app, itemId, ids);
  return untilGone(CONNECTION_FOREIGN_KEYS, work, {
    outcome: "unknown",
  } satisfies AccessReread);
}

// Who may see the item now, as the connection's account sees it, or `gone`.
async function accessNow(
  source: SourceClient,
  app: Followed,
  itemId: string,
): Promise<{ access: AccessEntry[]; addresses: string[] } | "gone"> {
  if (app === "calendar") return readInviteAccess(source, itemId);
  const access = await readAccess(source, itemId);
  return access === "gone" ? "gone" : { access, addresses: [] };
}

// Rewrites the access lists of the records `ids` of the item, or deletes them.
async function rewrite(
  ctx: Ctx,
  source: SourceClient,
  app: Followed,
  itemId: string,
  ids: string[],
): Promise<AccessReread> {
  // Its source can't be reached until it's reconnected; tomorrow night's run tries again.
  if (source.connection.needsReauth) return { outcome: "unreachable" };
  const connectionId = source.connection.id;
  const now = await accessNow(source, app, itemId);
  const db = forOrg(ctx);
  if (now === "gone") {
    await db.delete(sourceRecords, inArray(sourceRecords.id, ids));
    return { outcome: "removed" };
  }
  await db.transaction(async (tx) => {
    await tx.delete(accessListEntries, inArray(accessListEntries.sourceRecordId, ids));
    const kept = await tx.update(
      sourceRecords,
      { accessCheckedAt: clockNow() },
      inArray(sourceRecords.id, ids),
    );
    await tx.insert(
      accessListEntries,
      kept.flatMap((record) =>
        accessRows(now).map((row) => ({ connectionId, sourceRecordId: record.id, ...row })),
      ),
      { onConflictDoNothing: true },
    );
  });
  return { outcome: "rewritten" };
}
