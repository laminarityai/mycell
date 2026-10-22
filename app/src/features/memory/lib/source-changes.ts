// Following each app's deletions and sharing changes (ADR-0023, ADR-0024), as the org's system
// ctx (ADR-0009). An item gone from a connection's app (discovery's `discovery/item.removed`)
// deletes that connection's source records of it, and migration 0026's triggers then delete the
// facts left with no source and the objects left with no facts, in the same statement. A Drive
// file changed in place (`discovery/item.changed`) has its sharing list read again, and its
// records' access lists rewritten from it; one Drive no longer gives the account goes as if
// removed. Every night, each Drive file memory learned from is read again the same way, as a
// backstop for a change the feed missed. Gmail messages never change who is on them, so only
// their deletions are followed.
import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import { isForeignKeyViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { getConnection } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { AccessReread, ChangedItem, RemovedItem } from "../types";
import { driveVersion, readAccess } from "./drive";
import type { RunStep } from "./learn";
import { accessListEntries, sourceRecords } from "./schema";

// Drive source records per nightly step: each needs one files.get.
const REREAD_BATCH = 100;

const runInline: RunStep = (_id, run) => run();

/**
 * Deletes the connection's source records of an item gone from its app: a Gmail message by its
 * ID, or every version of a Drive file by the file's ID. Facts only they supported go with them.
 * Returns how many records went.
 */
export async function deleteRemovedItem(ctx: Ctx, item: RemovedItem): Promise<{ records: number }> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const deleted = await forOrg(ctx).delete(
    sourceRecords,
    and(
      eq(sourceRecords.connectionId, item.connectionId),
      eq(sourceRecords.app, item.app),
      item.app === "drive"
        ? eq(sourceRecords.itemKey, item.itemId)
        : eq(sourceRecords.sourceRef, item.itemId),
    ),
  );
  return { records: deleted.length };
}

/** Reads again who may see a Drive file changed in place, and rewrites what memory keeps. */
export async function rereadAccess(ctx: Ctx, item: ChangedItem): Promise<AccessReread> {
  if (ctx.role !== "system") throw new ForbiddenError();
  return reread(ctx, item.connectionId, driveVersion(item.sourceRef).fileId);
}

/**
 * The nightly backstop: reads again who may see each Drive file memory learned from and hasn't
 * re-read since this run began, a batch of records per step. Returns how many files it read
 * and how many of those Drive no longer gave their connection's account.
 */
export async function rereadDriveAccess(
  ctx: Ctx,
  runStep: RunStep = runInline,
): Promise<{ files: number; removed: number }> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const { startedAt } = await runStep("start", () =>
    Promise.resolve({ startedAt: new Date().toISOString() }),
  );
  const totals = { files: 0, removed: 0 };
  let after: string | null = null;
  for (let batch = 0; ; batch += 1) {
    const done: Batch = await runStep(`reread-${String(batch)}`, () =>
      rereadBatch(ctx, new Date(startedAt), after),
    );
    totals.files += done.files;
    totals.removed += done.removed;
    if (done.next === null) return totals;
    after = done.next;
  }
}

type Batch = { files: number; removed: number; next: string | null };

// The next batch of Drive records by ID, after `after`, not re-read since `checkedBefore`.
async function rereadBatch(ctx: Ctx, checkedBefore: Date, after: string | null): Promise<Batch> {
  const db = forOrg(ctx);
  const records = await db.select(sourceRecords, {
    where: and(
      eq(sourceRecords.app, "drive"),
      lte(sourceRecords.accessCheckedAt, checkedBefore),
      after === null ? undefined : gt(sourceRecords.id, after),
    ),
    orderBy: [asc(sourceRecords.id)],
    limit: REREAD_BATCH,
  });
  const seen = new Set<string>();
  const done: Batch = { files: 0, removed: 0, next: null };
  for (const record of records) {
    // A connection's records of one file are re-read together.
    const file = `${record.connectionId}\n${record.itemKey}`;
    if (seen.has(file)) continue;
    seen.add(file);
    const { outcome } = await reread(ctx, record.connectionId, record.itemKey);
    if (outcome === "rewritten" || outcome === "removed") done.files += 1;
    if (outcome === "removed") done.removed += 1;
  }
  const last = records.at(-1);
  return { ...done, next: records.length < REREAD_BATCH || last === undefined ? null : last.id };
}

const CONNECTION_FOREIGN_KEYS = [
  "access_list_entries_connection_fk",
  "access_list_entries_source_record_fk",
];

// Reads the file's sharing list through the connection, and rewrites the access lists of the
// connection's records of it, or deletes them when Drive no longer gives the account the file.
async function reread(ctx: Ctx, connectionId: string, fileId: string): Promise<AccessReread> {
  const db = forOrg(ctx);
  const records = await db.select(sourceRecords, {
    where: and(
      eq(sourceRecords.connectionId, connectionId),
      eq(sourceRecords.app, "drive"),
      eq(sourceRecords.itemKey, fileId),
    ),
  });
  // Memory learned nothing from it: a file that isn't a Google Doc, say.
  if (records.length === 0) return { outcome: "unknown" };
  const ids = records.map((record) => record.id);
  let access: Awaited<ReturnType<typeof readAccess>>;
  try {
    // Its source can't be reached until it's reconnected; tomorrow night's run tries again.
    if ((await getConnection(ctx, connectionId)).needsReauth) return { outcome: "unreachable" };
    access = await readAccess(ctx, connectionId, fileId);
  } catch (error) {
    // The connection went meanwhile, and its records with it.
    if (error instanceof NotFoundError) return { outcome: "unknown" };
    throw error;
  }
  if (access === "gone") {
    await db.delete(sourceRecords, inArray(sourceRecords.id, ids));
    return { outcome: "removed" };
  }
  const entries = access;
  try {
    await db.transaction(async (tx) => {
      await tx.delete(accessListEntries, inArray(accessListEntries.sourceRecordId, ids));
      const kept = await tx.update(
        sourceRecords,
        { accessCheckedAt: new Date() },
        inArray(sourceRecords.id, ids),
      );
      await tx.insert(
        accessListEntries,
        kept.flatMap((record) =>
          entries.map(({ kind, value }) => ({
            connectionId,
            sourceRecordId: record.id,
            kind,
            value,
          })),
        ),
        { onConflictDoNothing: true },
      );
    });
  } catch (error) {
    if (CONNECTION_FOREIGN_KEYS.some((name) => isForeignKeyViolation(error, name))) {
      return { outcome: "unknown" };
    }
    throw error;
  }
  return { outcome: "rewritten" };
}
