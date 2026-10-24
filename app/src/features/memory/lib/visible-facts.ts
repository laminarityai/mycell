// Turning stored facts into what one reader sees: only the facts with a source that reader can
// see (through the one visibility function), each with only those sources and its linked
// object. Reading an object and searching both go through it. Superseding is the reader's own
// too: a fact is history for them only when a newer fact in its timeline is one they can see,
// so a fact replaced by something they can't see stays current for them and never hints at it.
// Each takes the read's Reading, resolved once, and makes the same queries however long the
// timelines or large the org.
import { and, asc, inArray, sql, type SQL } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import type { FactSource, HistoricFact, MemoryFact } from "../types";
import { factSources, facts, memoryObjects, sourceRecords } from "./schema";
import { type Reading, visibleFact, visibleSourceRecords } from "./visibility";

export type FactRow = typeof facts.$inferSelect;

/**
 * A fact the viewer can see, with the sources they can see, and whether none of those came from
 * inside the company.
 */
export type SeenFact<F = FactRow> = { fact: F; sources: FactSource[]; outsideOnly: boolean };

/**
 * The facts among `rows` the viewer can see, in the order given: those with a source they can
 * see, and those they told Mycel themselves, which have no sources and count as from inside.
 */
export async function seenFacts<F extends Pick<FactRow, "id" | "toldByUserId">>(
  ctx: Ctx,
  reading: Reading,
  rows: F[],
): Promise<SeenFact<F>[]> {
  if (rows.length === 0) return [];
  const db = forOrg(ctx);
  const links = await db.select(factSources, {
    columns: ["factId", "sourceRecordId"],
    where: inArray(
      factSources.factId,
      rows.map((fact) => fact.id),
    ),
  });
  const recordIds = [...new Set(links.map((link) => link.sourceRecordId))];
  const visible = await visibleSourceRecords(ctx, reading, recordIds);
  const records =
    visible.size === 0
      ? []
      : await db.select(sourceRecords, {
          columns: [
            "id",
            "app",
            "connectionId",
            "sourceRef",
            "itemKey",
            "occurredAt",
            "fromInside",
          ],
          where: inArray(sourceRecords.id, [...visible]),
          orderBy: [asc(sourceRecords.occurredAt)],
        });

  return rows.flatMap((fact) => {
    if (fact.toldByUserId !== null) {
      const own = reading.viewer.userId !== null && fact.toldByUserId === reading.viewer.userId;
      return own ? [{ fact, sources: [], outsideOnly: false }] : [];
    }
    const linked = new Set(
      links.filter((link) => link.factId === fact.id).map((link) => link.sourceRecordId),
    );
    const seen = records.filter((record) => linked.has(record.id));
    const sources = seen.map(({ app, connectionId, sourceRef, itemKey, occurredAt }) => ({
      app,
      connectionId,
      sourceRef,
      itemKey,
      occurredAt,
    }));
    const outsideOnly = !seen.some((record) => record.fromInside);
    return sources.length === 0 ? [] : [{ fact, sources, outsideOnly }];
  });
}

/** What placing a fact in its timeline reads of it. */
type Link = Pick<FactRow, "id" | "supersededById" | "validFrom" | "recordedAt">;

/** A seen fact a newer fact the viewer can also see replaced. */
export type SeenHistory = SeenFact & { supersededAt: Date; supersededBy: Link };

/**
 * Splits seen facts into those current for the viewer and their history, each in the order
 * given. A current fact replaced only by facts the viewer can't see ends at no time they know.
 */
export async function overTime(
  ctx: Ctx,
  reading: Reading,
  seen: SeenFact[],
): Promise<{ current: SeenFact[]; history: SeenHistory[] }> {
  const rows = new Map<string, Link>(seen.map(({ fact }) => [fact.id, fact]));
  const visible = new Set(rows.keys());
  // Every newer fact in the seen facts' timelines, and which of them the viewer sees.
  const replaced = seen.flatMap(({ fact }) => (fact.supersededById === null ? [] : [fact.id]));
  if (replaced.length > 0) {
    const db = forOrg(ctx);
    const later = newerThan(ctx.orgId, replaced);
    const loaded = await db.select(facts, {
      columns: ["id", "supersededById", "validFrom", "recordedAt"],
      where: later,
    });
    for (const row of loaded) if (!rows.has(row.id)) rows.set(row.id, row);
    const shown = await db.select(facts, {
      columns: ["id"],
      where: and(later, visibleFact(reading)),
    });
    for (const { id } of shown) visible.add(id);
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

// SQL, on `facts`: whether the fact is newer in the timeline of one of the facts `ids`, by its
// chain of replacements however long, read in one query.
function newerThan(orgId: string, ids: string[]): SQL {
  return sql`${facts.id} in (
    with recursive chain(id) as (
      select ot_f.superseded_by_id from facts ot_f
      where ot_f.org_id = ${orgId} and ot_f.superseded_by_id is not null
        and ot_f.id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})
      union
      select ot_n.superseded_by_id from facts ot_n join chain on ot_n.id = chain.id
      where ot_n.org_id = ${orgId} and ot_n.superseded_by_id is not null)
    select id from chain)`;
}

/** History as the reader gets it. */
export async function describeHistory(
  ctx: Ctx,
  reading: Reading,
  history: SeenHistory[],
): Promise<HistoricFact[]> {
  const described = await describeFacts(ctx, reading, history);
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
export async function describeFacts(
  ctx: Ctx,
  reading: Reading,
  seen: SeenFact[],
): Promise<MemoryFact[]> {
  const linkedIds = [...new Set(seen.flatMap(({ fact }) => fact.objectId ?? []))];
  const linked =
    linkedIds.length === 0
      ? []
      : await forOrg(ctx).select(memoryObjects, {
          columns: ["id", "kind", "name"],
          where: inArray(memoryObjects.id, linkedIds),
        });
  const conflicting = await visibleFacts(
    ctx,
    reading,
    seen.flatMap(({ fact }) => fact.conflictsWithId ?? []),
  );
  return seen.map(({ fact, sources, outsideOnly }) => {
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
      outsideOnly,
      told: fact.toldByUserId !== null,
    };
  });
}

/** Which of the facts `ids` the reader can see. */
export async function visibleFacts(
  ctx: Ctx,
  reading: Reading,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await forOrg(ctx).select(facts, {
    columns: ["id"],
    where: and(inArray(facts.id, [...new Set(ids)]), visibleFact(reading)),
  });
  return new Set(rows.map((row) => row.id));
}
