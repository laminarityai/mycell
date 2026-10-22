// Storing what an item taught memory, in one transaction: its source record with its access
// list, its objects matched on exact keys (ADR-0022; fuzzy matching comes later), and its facts
// linked to the record. A fact with the same subject and statement as a current one is that
// fact, newly supported by this record. A copy of an item learned already, under the same item
// key in another mailbox, takes the facts its first copy taught, with no model call.
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { forOrg, type OrgScopedDb } from "@/db/for-org";
import type { ConnectionDetails } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import type { MemoryApp } from "../types";
import type { ExtractedFact, ExtractedObject } from "./extract";
import type { EmailToLearn } from "./gmail";
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

type Source = { connection: ConnectionDetails; app: MemoryApp; email: EmailToLearn };

/** Whether the connection's copy of the item is learned already. */
export async function isKnown(ctx: Ctx, connectionId: string, app: MemoryApp, sourceRef: string) {
  const rows = await forOrg(ctx).select(sourceRecords, {
    where: and(
      eq(sourceRecords.connectionId, connectionId),
      eq(sourceRecords.app, app),
      eq(sourceRecords.sourceRef, sourceRef),
    ),
    limit: 1,
  });
  return rows.length > 0;
}

/**
 * Links a new copy of an item to the facts another copy taught. Null when no other copy taught
 * any, so the item is learned from scratch.
 */
export async function storeCopy(ctx: Ctx, source: Source): Promise<Stored | null> {
  const db = forOrg(ctx);
  const copies = await db.select(sourceRecords, {
    where: and(
      eq(sourceRecords.itemKey, source.email.itemKey),
      eq(sourceRecords.app, source.app),
      ne(sourceRecords.connectionId, source.connection.id),
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
  const taught = await db.select(facts, { where: inArray(facts.id, factIds) });
  return db.transaction(async (tx) => {
    const recordId = await insertRecord(tx, source);
    if (recordId === null) return null;
    await linkFacts(tx, source.connection.id, recordId, factIds);
    return { objects: objectCount(taught), facts: factIds.length };
  });
}

/** Stores the item's source record, objects and facts. `embeddings` match `extracted.facts`. */
export async function storeLearned(
  ctx: Ctx,
  source: Source,
  extracted: { objects: ExtractedObject[]; facts: ExtractedFact[] },
  embeddings: number[][],
): Promise<Stored | null> {
  return forOrg(ctx).transaction(async (tx) => {
    const recordId = await insertRecord(tx, source);
    if (recordId === null) return null;
    const objectIds = new Map<string, string>();
    for (const object of extracted.objects) {
      objectIds.set(object.ref, await matchObject(tx, object));
    }
    const factIds: string[] = [];
    for (const [i, fact] of extracted.facts.entries()) {
      const subjectId = objectIds.get(fact.about);
      const embedding = embeddings.at(i);
      if (subjectId === undefined || embedding === undefined) continue;
      const objectId = fact.object === null ? null : (objectIds.get(fact.object) ?? null);
      factIds.push(await storeFact(tx, { ...fact, subjectId, objectId, embedding }));
    }
    await linkFacts(tx, source.connection.id, recordId, [...new Set(factIds)]);
    return { objects: objectIds.size, facts: new Set(factIds).size };
  });
}

// The new source record's ID, or null when the item was stored already (a retried step).
async function insertRecord(tx: OrgScopedDb, { connection, app, email }: Source) {
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
        sourceRef: email.sourceRef,
        itemKey: email.itemKey,
        occurredAt: email.occurredAt,
        accessCheckedAt: now,
      },
      { onConflictDoNothing: true },
    )
  ).at(0);
  if (record === undefined) return null;
  await tx.insert(
    accessListEntries,
    email.addresses.map((value) => ({
      connectionId: connection.id,
      sourceRecordId: record.id,
      kind: "address" as const,
      value,
    })),
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

// The object with one of its keys, given any keys it lacked; or a new object. An object with no
// keys (a deal, a project) is always new until fuzzy matching arrives. Learning runs one item
// at a time per org (memory's job), so two items never race to create one key.
async function matchObject(tx: OrgScopedDb, object: ExtractedObject): Promise<string> {
  let objectId: string | undefined;
  for (const key of object.keys) {
    const found = (
      await tx.select(objectKeys, {
        where: and(eq(objectKeys.kind, key.kind), eq(objectKeys.value, key.value)),
      })
    ).at(0);
    objectId ??= found?.objectId;
  }
  if (objectId === undefined) {
    const created = (
      await tx.insert(memoryObjects, {
        id: randomUUID(),
        kind: object.kind,
        name: object.name,
      })
    ).at(0);
    if (created === undefined) throw new Error("The object wasn't stored.");
    objectId = created.id;
  }
  const id = objectId;
  await tx.insert(
    objectKeys,
    object.keys.map((key) => ({ objectId: id, ...key })),
    { onConflictDoNothing: true },
  );
  return id;
}

type FactToStore = Omit<ExtractedFact, "about" | "object"> & {
  subjectId: string;
  objectId: string | null;
  embedding: number[];
};

async function storeFact(tx: OrgScopedDb, fact: FactToStore): Promise<string> {
  const same = (
    await tx.select(facts, {
      where: and(
        eq(facts.subjectId, fact.subjectId),
        eq(facts.statement, fact.statement),
        isNull(facts.supersededAt),
      ),
      limit: 1,
    })
  ).at(0);
  if (same !== undefined) return same.id;
  const created = (
    await tx.insert(facts, {
      id: randomUUID(),
      subjectId: fact.subjectId,
      statement: fact.statement,
      predicate: fact.predicate,
      value: fact.value,
      objectId: fact.objectId,
      origin: "source",
      validFrom: fact.validFrom,
      embedding: fact.embedding,
    })
  ).at(0);
  if (created === undefined) throw new Error("The fact wasn't stored.");
  return created.id;
}

function objectCount(rows: { subjectId: string; objectId: string | null }[]): number {
  return new Set(rows.flatMap((row) => [row.subjectId, ...(row.objectId ? [row.objectId] : [])]))
    .size;
}
