// Reading one object with the facts its reader can see, each with only the sources that reader
// can see. An object the reader can see no fact about is NotFoundError, as is one in another
// org: an ID or a key tells them nothing.
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import type { FactSource, MemoryFact, MemoryObject, ObjectLookup } from "../types";
import { factSources, facts, memoryObjects, objectKeys, sourceRecords } from "./schema";
import { viewerOf, visibleSourceRecords } from "./visibility";

export async function readObject(ctx: Ctx, lookup: ObjectLookup): Promise<MemoryObject> {
  const db = forOrg(ctx);
  const object = await findObject(ctx, lookup);
  if (object === undefined) throw new NotFoundError("object");

  // Current facts only: superseded history joins with superseding.
  const about = await db.select(facts, {
    where: and(eq(facts.subjectId, object.id), isNull(facts.supersededAt)),
    orderBy: [asc(facts.recordedAt), asc(facts.id)],
  });
  const links =
    about.length === 0
      ? []
      : await db.select(factSources, {
          where: inArray(
            factSources.factId,
            about.map((fact) => fact.id),
          ),
        });
  const recordIds = [...new Set(links.map((link) => link.sourceRecordId))];
  const visible = await visibleSourceRecords(ctx, await viewerOf(ctx), recordIds);
  const records =
    visible.size === 0
      ? []
      : await db.select(sourceRecords, {
          where: inArray(sourceRecords.id, [...visible]),
          orderBy: [asc(sourceRecords.occurredAt)],
        });

  const sourcesOf = (factId: string): FactSource[] => {
    const linked = new Set(
      links.filter((link) => link.factId === factId).map((link) => link.sourceRecordId),
    );
    return records
      .filter((record) => linked.has(record.id))
      .map(({ app, connectionId, sourceRef, occurredAt }) => ({
        app,
        connectionId,
        sourceRef,
        occurredAt,
      }));
  };
  const seen = about.flatMap((fact) => {
    const sources = sourcesOf(fact.id);
    return sources.length === 0 ? [] : [{ fact, sources }];
  });
  if (seen.length === 0) throw new NotFoundError("object");

  const linkedIds = [...new Set(seen.flatMap(({ fact }) => fact.objectId ?? []))];
  const linked =
    linkedIds.length === 0
      ? []
      : await db.select(memoryObjects, {
          where: inArray(memoryObjects.id, linkedIds),
        });
  const keys = await db.select(objectKeys, {
    where: eq(objectKeys.objectId, object.id),
    orderBy: [asc(objectKeys.kind), asc(objectKeys.value)],
  });
  return {
    id: object.id,
    kind: object.kind,
    name: object.name,
    keys: keys.map(({ kind, value }) => ({ kind, value })),
    facts: seen.map(({ fact, sources }): MemoryFact => {
      const other = linked.find((candidate) => candidate.id === fact.objectId);
      return {
        id: fact.id,
        statement: fact.statement,
        predicate: fact.predicate,
        value: fact.value,
        linkedObject:
          other === undefined ? null : { id: other.id, kind: other.kind, name: other.name },
        validFrom: fact.validFrom,
        validUntil: fact.validUntil,
        recordedAt: fact.recordedAt,
        sources,
      };
    }),
  };
}

async function findObject(ctx: Ctx, lookup: ObjectLookup) {
  const db = forOrg(ctx);
  let id: string;
  if ("id" in lookup) {
    id = lookup.id;
  } else {
    const key = (
      await db.select(objectKeys, {
        where: and(
          eq(objectKeys.kind, lookup.key.kind),
          eq(objectKeys.value, lookup.key.value.trim().toLowerCase()),
        ),
      })
    ).at(0);
    if (key === undefined) return undefined;
    id = key.objectId;
  }
  const object = (await db.select(memoryObjects, { where: eq(memoryObjects.id, id) })).at(0);
  return object;
}
