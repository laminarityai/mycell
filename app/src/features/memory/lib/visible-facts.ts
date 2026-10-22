// Turning stored facts into what one reader sees: only the facts with a source that reader can
// see (through the one visibility function), each with only those sources and its linked
// object. Reading an object and searching both go through it. Superseding is the reader's own
// too: a fact is history for them only when a newer fact in its timeline is one they can see,
// so a fact replaced by something they can't see stays current for them and never hints at it.
import { asc, inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import type { FactSource, HistoricFact, MemoryFact } from "../types";
import { factSources, facts, memoryObjects, sourceRecords } from "./schema";
import { type Viewer, viewerOf, visibleSourceRecords } from "./visibility";

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

/** A seen fact a newer fact the viewer can also see replaced. */
export type SeenHistory = SeenFact & { supersededAt: Date; supersededBy: FactRow };

/**
 * Splits seen facts into those current for the viewer and their history, each in the order
 * given. A current fact replaced only by facts the viewer can't see ends at no time they know.
 */
export async function overTime(
  ctx: Ctx,
  viewer: Viewer,
  seen: SeenFact[],
): Promise<{ current: SeenFact[]; history: SeenHistory[] }> {
  const rows = new Map(seen.map(({ fact }) => [fact.id, fact]));
  const visible = new Set(rows.keys());
  // Every newer fact in the seen facts' timelines, and which of them the viewer sees.
  let frontier = newer([...rows.values()], rows);
  while (frontier.length > 0) {
    const loaded = await forOrg(ctx).select(facts, { where: inArray(facts.id, frontier) });
    for (const row of loaded) rows.set(row.id, row);
    for (const { fact } of await seenFacts(ctx, viewer, loaded)) visible.add(fact.id);
    frontier = newer(loaded, rows);
  }

  const current: SeenFact[] = [];
  const history: SeenHistory[] = [];
  for (const found of seen) {
    const { fact } = found;
    let next = fact.supersededById;
    const passed = new Set([fact.id]);
    while (next !== null && !visible.has(next) && !passed.has(next)) {
      passed.add(next);
      next = rows.get(next)?.supersededById ?? null;
    }
    const replacement = next === null || next === fact.id ? undefined : rows.get(next);
    if (replacement === undefined || !visible.has(replacement.id)) {
      const ended = fact.supersededById === null;
      current.push(ended ? found : { ...found, fact: { ...fact, validUntil: null } });
      continue;
    }
    history.push({
      ...found,
      fact: { ...fact, validUntil: replacement.validFrom },
      // When memory recorded the replacement it can see: the later of the two facts' records.
      supersededAt:
        replacement.id === fact.supersededById && fact.supersededAt !== null
          ? fact.supersededAt
          : new Date(Math.max(fact.recordedAt.getTime(), replacement.recordedAt.getTime())),
      supersededBy: replacement,
    });
  }
  return { current, history };
}

// The facts replacing `from` that aren't loaded yet.
function newer(from: FactRow[], rows: Map<string, FactRow>): string[] {
  return [
    ...new Set(from.flatMap((row) => row.supersededById ?? []).filter((id) => !rows.has(id))),
  ];
}

/** History as the reader gets it. */
export async function describeHistory(ctx: Ctx, history: SeenHistory[]): Promise<HistoricFact[]> {
  const described = await describeFacts(ctx, history);
  return described.flatMap((fact, i) => {
    const seen = history.at(i);
    return seen === undefined
      ? []
      : [{ ...fact, supersededAt: seen.supersededAt, supersededBy: seen.supersededBy.id }];
  });
}

/**
 * Seen facts as the reader gets them, each with the object it links its subject to, and the
 * fact it contradicts when the reader can see that one.
 */
export async function describeFacts(ctx: Ctx, seen: SeenFact[]): Promise<MemoryFact[]> {
  const linkedIds = [...new Set(seen.flatMap(({ fact }) => fact.objectId ?? []))];
  const linked =
    linkedIds.length === 0
      ? []
      : await forOrg(ctx).select(memoryObjects, {
          where: inArray(memoryObjects.id, linkedIds),
        });
  const conflicting = await visibleFacts(
    ctx,
    seen.flatMap(({ fact }) => fact.conflictsWithId ?? []),
  );
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
      conflictsWith:
        fact.conflictsWithId !== null && conflicting.has(fact.conflictsWithId)
          ? fact.conflictsWithId
          : null,
    };
  });
}

// Which of the facts `ids` the reader can see.
async function visibleFacts(ctx: Ctx, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await forOrg(ctx).select(facts, { where: inArray(facts.id, [...new Set(ids)]) });
  const seen = await seenFacts(ctx, await viewerOf(ctx), rows);
  return new Set(seen.map(({ fact }) => fact.id));
}
