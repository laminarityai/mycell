// Turning stored facts into what one reader sees: only the facts with a source that reader can
// see (through the one visibility function), each with only those sources and its linked
// object. Reading an object and searching both go through it.
import { asc, inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import type { FactSource, MemoryFact } from "../types";
import { factSources, facts, memoryObjects, sourceRecords } from "./schema";
import { type Viewer, visibleSourceRecords } from "./visibility";

export type FactRow = typeof facts.$inferSelect;

/** A fact the viewer can see, with the sources they can see. */
export type SeenFact = { fact: FactRow; sources: FactSource[] };

/** The facts among `rows` the viewer can see, in the order given. */
export async function seenFacts(ctx: Ctx, viewer: Viewer, rows: FactRow[]): Promise<SeenFact[]> {
  if (rows.length === 0) return [];
  const db = forOrg(ctx);
  const links = await db.select(factSources, {
    where: inArray(
      factSources.factId,
      rows.map((fact) => fact.id),
    ),
  });
  const recordIds = [...new Set(links.map((link) => link.sourceRecordId))];
  const visible = await visibleSourceRecords(ctx, viewer, recordIds);
  const records =
    visible.size === 0
      ? []
      : await db.select(sourceRecords, {
          where: inArray(sourceRecords.id, [...visible]),
          orderBy: [asc(sourceRecords.occurredAt)],
        });

  return rows.flatMap((fact) => {
    const linked = new Set(
      links.filter((link) => link.factId === fact.id).map((link) => link.sourceRecordId),
    );
    const sources = records
      .filter((record) => linked.has(record.id))
      .map(({ app, connectionId, sourceRef, occurredAt }) => ({
        app,
        connectionId,
        sourceRef,
        occurredAt,
      }));
    return sources.length === 0 ? [] : [{ fact, sources }];
  });
}

/** Seen facts as the reader gets them, each with the object it links its subject to. */
export async function describeFacts(ctx: Ctx, seen: SeenFact[]): Promise<MemoryFact[]> {
  const linkedIds = [...new Set(seen.flatMap(({ fact }) => fact.objectId ?? []))];
  const linked =
    linkedIds.length === 0
      ? []
      : await forOrg(ctx).select(memoryObjects, {
          where: inArray(memoryObjects.id, linkedIds),
        });
  return seen.map(({ fact, sources }) => {
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
  });
}
