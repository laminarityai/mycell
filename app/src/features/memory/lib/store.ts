// Storing what an item taught memory, in one transaction: its source record with its access
// list, its objects (each the existing object matching found, given any keys it lacked, or a new
// one), and its facts linked to the record. A fact with the same subject and statement as a
// current one is that fact, newly supported by this record; a new fact takes its place in its
// subject's timeline for its predicate, superseding an older one (`supersede.ts`). A copy of an
// item learned already, under the same item key in another mailbox or Drive, takes the facts its
// first copy taught, with no model call.
//
// A Drive file changes: each version is its own source record, and a copy teaches the same facts
// only at the same version, whose `source_ref` (`<file ID>@<modified time>`) every connection
// shares. A connection keeps only the latest version it learned from: once a newer one is
// decided, its older versions' records go, and with them the facts only they supported.
import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import { forOrg, type OrgScopedDb } from "@/db/for-org";
import type { SourceClient } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import type { MemoryApp } from "../types";
import { driveVersion } from "./drive";
import type { ExtractedFact, ExtractedObject } from "./extract";
import type { Matches } from "./match";
import type { SourceItem } from "./source-item";
import { placeInTimelines } from "./supersede";
import { companyWideOf } from "./visibility";
import {
  accessListEntries,
  factSources,
  facts,
  memoryObjects,
  objectKeys,
  sourceRecords,
} from "./schema";

/** How many objects and facts a stored item is linked to. */
export type Stored = { objects: number; facts: number };

type Source = { connection: SourceClient["connection"]; app: MemoryApp; item: SourceItem };

/**
 * Whether the connection's copy of the item is learned already: for a Drive file, this version
 * or a newer one.
 */
export async function isKnown(ctx: Ctx, connectionId: string, app: MemoryApp, sourceRef: string) {
  const sameItem =
    app === "drive"
      ? and(
          eq(sourceRecords.itemKey, driveVersion(sourceRef).fileId),
          gte(sourceRecords.occurredAt, driveVersion(sourceRef).modifiedAt),
        )
      : eq(sourceRecords.sourceRef, sourceRef);
  const rows = await forOrg(ctx).select(sourceRecords, {
    where: and(eq(sourceRecords.connectionId, connectionId), eq(sourceRecords.app, app), sameItem),
    limit: 1,
  });
  return rows.length > 0;
}

/**
 * Deletes the connection's records of the item's older versions (a Drive file's), once a newer
 * one is decided: the facts only they supported go with them (migration 0026's triggers).
 * Nothing for an email, which never changes.
 */
export async function retireOlderVersions(ctx: Ctx, source: Source): Promise<void> {
  await retire(forOrg(ctx), source);
}

async function retire(db: OrgScopedDb, { connection, app, item }: Source): Promise<void> {
  if (app !== "drive") return;
  await db.delete(
    sourceRecords,
    and(
      eq(sourceRecords.connectionId, connection.id),
      eq(sourceRecords.app, app),
      eq(sourceRecords.itemKey, item.itemKey),
      lt(sourceRecords.occurredAt, item.occurredAt),
    ),
  );
}

/**
 * Links a new copy of an item to the facts another copy taught. Null when no other copy taught
 * any, so the item is learned from scratch.
 */
export async function storeCopy(ctx: Ctx, source: Source): Promise<Stored | null> {
  const db = forOrg(ctx);
  const copies = await db.select(sourceRecords, {
    where: and(
      eq(sourceRecords.itemKey, source.item.itemKey),
      eq(sourceRecords.app, source.app),
      ne(sourceRecords.connectionId, source.connection.id),
      // The same version of a Drive file.
      source.app === "drive" ? eq(sourceRecords.sourceRef, source.item.sourceRef) : undefined,
    ),
  });
  if (copies.length === 0) return null;
  const links = await db.select(factSources, {
    where: inArray(
      factSources.sourceRecordId,
      copies.map((copy) => copy.id),
    ),
  });
  const factIds = [...new Set(links.map((link) => link.factId))];
  if (factIds.length === 0) return null;
  // Only what's counted: a fact's embedding alone is 1536 numbers.
  const taught = await db.select(facts, {
    columns: ["subjectId", "objectId"],
    where: inArray(facts.id, factIds),
  });
  const companyWide = await companyWideOf(ctx);
  return db.transaction(async (tx) => {
    const recordId = await insertRecord(tx, source);
    if (recordId === null) return null;
    await linkFacts(tx, source.connection.id, recordId, factIds);
    // This copy may come from inside, or be company-wide, where the first wasn't.
    await placeInTimelines(tx, ctx.orgId, companyWide, factIds);
    await retire(tx, source);
    return { objects: objectCount(taught), facts: factIds.length };
  });
}

/**
 * Stores the item's source record, objects and facts. `embeddings` match `extracted.facts`, and
 * `matches` are the existing objects matching found.
 */
export async function storeLearned(
  ctx: Ctx,
  source: Source,
  extracted: { objects: ExtractedObject[]; facts: ExtractedFact[] },
  embeddings: number[][],
  matches: Matches,
): Promise<Stored | null> {
  const companyWide = await companyWideOf(ctx);
  return forOrg(ctx).transaction(async (tx) => {
    const recordId = await insertRecord(tx, source);
    if (recordId === null) return null;
    const objectIds = new Map<string, string>();
    for (const object of extracted.objects) {
      objectIds.set(object.ref, await storeObject(tx, object, matches.get(object.ref)));
    }
    const factIds: string[] = [];
    const added = new Set<string>();
    for (const [i, fact] of extracted.facts.entries()) {
      const subjectId = objectIds.get(fact.about);
      const embedding = embeddings.at(i);
      if (subjectId === undefined || embedding === undefined) continue;
      const objectId = fact.object === null ? null : (objectIds.get(fact.object) ?? null);
      const stored = await storeFact(tx, { ...fact, subjectId, objectId, embedding });
      factIds.push(stored.id);
      if (stored.added) added.add(stored.id);
    }
    const ids = [...new Set(factIds)];
    await linkFacts(tx, source.connection.id, recordId, ids);
    // Once linked, so who stated each fact, and when, is known.
    await placeInTimelines(tx, ctx.orgId, companyWide, ids, added);
    // After linking, so a fact the older version also taught keeps its ID.
    await retire(tx, source);
    return { objects: new Set(objectIds.values()).size, facts: ids.length };
  });
}

// The new source record's ID, or null when the item was stored already (a retried step).
async function insertRecord(tx: OrgScopedDb, { connection, app, item }: Source) {
  const now = new Date();
  const record = (
    await tx.insert(
      sourceRecords,
      {
        id: randomUUID(),
        connectionId: connection.id,
        ownerScope: connection.kind,
        ownerUserId: connection.ownerUserId,
        app,
        sourceRef: item.sourceRef,
        itemKey: item.itemKey,
        occurredAt: item.occurredAt,
        accessCheckedAt: now,
        fromInside: item.fromInside,
      },
      { onConflictDoNothing: true },
    )
  ).at(0);
  if (record === undefined) return null;
  const confirmed = new Set(item.access.map((entry) => `${entry.kind}:${entry.value}`));
  // The addresses its sender wrote that Mycel didn't see reach anyone: for exclusions only.
  const unconfirmed = item.addresses
    .filter((value) => !confirmed.has(`address:${value}`))
    .map((value) => ({ kind: "address" as const, value, confirmed: false }));
  await tx.insert(
    accessListEntries,
    [...item.access.map((entry) => ({ ...entry, confirmed: true })), ...unconfirmed].map(
      ({ kind, value, confirmed }) => ({
        connectionId: connection.id,
        sourceRecordId: record.id,
        kind,
        value,
        confirmed,
      }),
    ),
    { onConflictDoNothing: true },
  );
  return record.id;
}

async function linkFacts(tx: OrgScopedDb, connectionId: string, recordId: string, ids: string[]) {
  await tx.insert(
    factSources,
    ids.map((factId) => ({ connectionId, factId, sourceRecordId: recordId })),
    { onConflictDoNothing: true },
  );
}

// The matched object, given any keys it lacked, or a new object. Learning runs one item at a
// time per org (memory's job), so nothing has taken a key since matching looked.
async function storeObject(
  tx: OrgScopedDb,
  object: ExtractedObject,
  matched: string | undefined,
): Promise<string> {
  const objectId = matched ?? randomUUID();
  if (matched === undefined) {
    await tx.insert(memoryObjects, { id: objectId, kind: object.kind, name: object.name });
  }
  await tx.insert(
    objectKeys,
    object.keys.map((key) => ({ objectId, ...key })),
    { onConflictDoNothing: true },
  );
  return objectId;
}

type FactToStore = Omit<ExtractedFact, "about" | "object"> & {
  subjectId: string;
  objectId: string | null;
  embedding: number[];
};

// The current learned fact with the same subject and statement, or a new fact (`added`), placed
// in its timeline once linked to its source. Never a fact a person told Mycel: linking a source
// to it would show it to everyone who sees that source.
async function storeFact(
  tx: OrgScopedDb,
  fact: FactToStore,
): Promise<{ id: string; added: boolean }> {
  const same = (
    await tx.select(facts, {
      where: and(
        eq(facts.subjectId, fact.subjectId),
        eq(facts.statement, fact.statement),
        eq(facts.origin, "source"),
        isNull(facts.supersededAt),
      ),
      limit: 1,
    })
  ).at(0);
  if (same !== undefined) return { id: same.id, added: false };
  const id = randomUUID();
  await tx.insert(facts, {
    id,
    subjectId: fact.subjectId,
    statement: fact.statement,
    predicate: fact.predicate,
    value: fact.value,
    objectId: fact.objectId,
    origin: "source",
    validFrom: fact.validFrom,
    embedding: fact.embedding,
  });
  return { id, added: true };
}

function objectCount(rows: { subjectId: string; objectId: string | null }[]): number {
  return new Set(rows.flatMap((row) => [row.subjectId, ...(row.objectId ? [row.objectId] : [])]))
    .size;
}
