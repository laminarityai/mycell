// Keeping facts that change over time (ADR-0022). Facts about one subject with one predicate
// (renewal_date, role) form a timeline, since a predicate names something its subject has one
// value of at a time: the newest is current, and each older one is superseded by the next,
// keeping when it was recorded as replaced (`superseded_at`), a pointer to its replacement and,
// when the replacement says when it became true, when it stopped being true (`valid_until`).
// Facts are ordered by when they became true, as their sources say: their valid time, or else
// when the first item stating them happened. So an older email learned after a newer one (a
// backfill reads newest first) goes into history, not over the newer fact. A fact with no
// predicate is never superseded. Who sees which part of a timeline is the reader's own: see
// `visible-facts.ts`.
import { and, eq, inArray } from "drizzle-orm";
import type { OrgScopedDb } from "@/db/for-org";
import { factSources, facts, sourceRecords } from "./schema";

type FactRow = typeof facts.$inferSelect;

/**
 * Places a newly stored fact in its subject's timeline for its predicate, relinking the facts
 * on either side. `statedAt` is when the item stating it happened.
 */
export async function placeInTimeline(
  tx: OrgScopedDb,
  fact: FactRow,
  statedAt: Date,
): Promise<void> {
  if (fact.predicate === null) return;
  const timeline = await tx.select(facts, {
    where: and(eq(facts.subjectId, fact.subjectId), eq(facts.predicate, fact.predicate)),
  });
  if (timeline.length < 2) return;
  const firstStated = await firstStatedTimes(
    tx,
    timeline.filter((other) => other.id !== fact.id),
  );
  const becameTrue = (row: FactRow) =>
    (
      row.validFrom ??
      (row.id === fact.id ? statedAt : firstStated.get(row.id)) ??
      row.recordedAt
    ).getTime();
  // Oldest first. On a tie the new fact is the newer, as the last word.
  const ordered = timeline.toSorted(
    (a, b) =>
      becameTrue(a) - becameTrue(b) ||
      Number(a.id === fact.id) - Number(b.id === fact.id) ||
      a.recordedAt.getTime() - b.recordedAt.getTime() ||
      a.id.localeCompare(b.id),
  );

  const now = new Date();
  for (const [i, row] of ordered.entries()) {
    const next = ordered.at(i + 1);
    const linked = {
      supersededById: next?.id ?? null,
      supersededAt: next === undefined ? null : (row.supersededAt ?? now),
      validUntil: next?.validFrom ?? null,
    };
    if (
      row.supersededById === linked.supersededById &&
      row.supersededAt?.getTime() === linked.supersededAt?.getTime() &&
      row.validUntil?.getTime() === linked.validUntil?.getTime()
    ) {
      continue;
    }
    await tx.update(facts, linked, eq(facts.id, row.id));
  }
}

// When the first item stating each fact happened.
async function firstStatedTimes(tx: OrgScopedDb, rows: FactRow[]): Promise<Map<string, Date>> {
  const links = await tx.select(factSources, {
    where: inArray(
      factSources.factId,
      rows.map((row) => row.id),
    ),
  });
  if (links.length === 0) return new Map();
  const records = await tx.select(sourceRecords, {
    where: inArray(sourceRecords.id, [...new Set(links.map((link) => link.sourceRecordId))]),
  });
  const times = new Map<string, Date>();
  for (const link of links) {
    const record = records.find((candidate) => candidate.id === link.sourceRecordId);
    const known = times.get(link.factId);
    if (record !== undefined && (known === undefined || record.occurredAt < known)) {
      times.set(link.factId, record.occurredAt);
    }
  }
  return times;
}
