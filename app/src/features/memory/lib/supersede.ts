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
//
// Who stated a fact matters too: anyone can email the company. A fact stated only from outside
// (no source of it came from inside the company: `source_records.from_inside`) never supersedes
// one that a source from inside, or a company-wide source, supports. Both stay current, and the
// outside fact records which fact it contradicts (`conflicts_with_id`), so a reader sees the
// conflict instead of a stranger's word replacing the company's. An outside fact can still
// supersede another that only private, outside sources support (the same customer writing
// again), and a fact from inside supersedes anything older.
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { OrgScopedDb } from "@/db/for-org";
import { factSources, facts, sourceRecords } from "./schema";
import { type CompanyWide, recordCompanyWide } from "./visibility";

// What placing a fact in its timeline reads of it: never its embedding.
const TIMELINE_COLUMNS = [
  "id",
  "origin",
  "validFrom",
  "validUntil",
  "recordedAt",
  "supersededAt",
  "supersededById",
  "conflictsWithId",
] as const;
type FactRow = Pick<typeof facts.$inferSelect, (typeof TIMELINE_COLUMNS)[number]>;

/**
 * Places the facts in their subjects' timelines for their predicates, relinking each timeline
 * once, after their sources are linked: a new fact, or one a new source now supports (which can
 * change who stated it). `added` are the facts just stored, which are the newer on a tie.
 */
export async function placeInTimelines(
  tx: OrgScopedDb,
  orgId: string,
  companyWide: CompanyWide,
  factIds: string[],
  added: Set<string> = new Set(),
): Promise<void> {
  if (factIds.length === 0) return;
  const placed = await tx.select(facts, {
    columns: ["subjectId", "predicate"],
    where: inArray(facts.id, factIds),
  });
  const timelines = new Map<string, SQL>();
  for (const fact of placed) {
    if (fact.predicate === null) continue;
    timelines.set(
      JSON.stringify([fact.subjectId, fact.predicate]),
      and(eq(facts.subjectId, fact.subjectId), eq(facts.predicate, fact.predicate)) ?? sql`false`,
    );
  }
  for (const where of timelines.values()) {
    const timeline = await tx.select(facts, { columns: TIMELINE_COLUMNS, where });
    await relink(tx, await standingOf(tx, orgId, companyWide, timeline), added);
  }
}

/** A fact with who stated it, and when its first source happened. */
type Standing = {
  row: FactRow;
  // Some source of it came from inside the company.
  inside: boolean;
  // Some source of it is company-wide.
  companyWide: boolean;
  firstStated: Date | undefined;
};

async function relink(tx: OrgScopedDb, timeline: Standing[], added: Set<string>) {
  const becameTrue = ({ row, firstStated }: Standing) =>
    (row.validFrom ?? firstStated ?? row.recordedAt).getTime();
  // Oldest first. On a tie a fact just stored is the newer, as the last word.
  const ordered = timeline.toSorted(
    (a, b) =>
      becameTrue(a) - becameTrue(b) ||
      Number(added.has(a.row.id)) - Number(added.has(b.row.id)) ||
      a.row.recordedAt.getTime() - b.row.recordedAt.getTime() ||
      a.row.id.localeCompare(b.row.id),
  );
  // Told by a person (M9) counts as from inside.
  const outsideOnly = (fact: Standing) => fact.row.origin === "source" && !fact.inside;
  const stands = (fact: Standing) => fact.inside || fact.companyWide;

  // Each fact's replacement: the next newer fact that may supersede it. A newer fact stated
  // only from outside may not supersede one that stands, and records the conflict instead.
  const conflicts = new Map<string, string | null>(ordered.map(({ row }) => [row.id, null]));
  const replacements = ordered.map((fact, i) => {
    for (const newer of ordered.slice(i + 1)) {
      if (!(outsideOnly(newer) && stands(fact))) return newer.row;
      conflicts.set(newer.row.id, fact.row.id);
    }
    return undefined;
  });

  const now = new Date();
  const changed = ordered.flatMap(({ row }, i) => {
    const next = replacements[i];
    const linked: Linked = {
      supersededById: next?.id ?? null,
      supersededAt: next === undefined ? null : (row.supersededAt ?? now),
      validUntil: next?.validFrom ?? null,
      conflictsWithId: conflicts.get(row.id) ?? null,
    };
    const same =
      row.supersededById === linked.supersededById &&
      row.supersededAt?.getTime() === linked.supersededAt?.getTime() &&
      row.validUntil?.getTime() === linked.validUntil?.getTime() &&
      row.conflictsWithId === linked.conflictsWithId;
    return same ? [] : [{ id: row.id, linked }];
  });
  if (changed.length === 0) return;
  // One update for every fact whose links changed, each set to its own values.
  const each = (column: keyof Linked, type: "text" | "timestamptz") =>
    sql`(case ${facts.id} ${sql.join(
      changed.map(({ id, linked }) => sql`when ${id} then ${linked[column]}`),
      sql` `,
    )} end)::${sql.raw(type)}`;
  await tx.update(
    facts,
    {
      supersededById: each("supersededById", "text"),
      supersededAt: each("supersededAt", "timestamptz"),
      validUntil: each("validUntil", "timestamptz"),
      conflictsWithId: each("conflictsWithId", "text"),
    },
    inArray(
      facts.id,
      changed.map(({ id }) => id),
    ),
  );
}

type Linked = Pick<FactRow, "supersededById" | "supersededAt" | "validUntil" | "conflictsWithId">;

// Who stated each fact, and when the first item stating it happened.
async function standingOf(
  tx: OrgScopedDb,
  orgId: string,
  companyWide: CompanyWide,
  rows: FactRow[],
): Promise<Standing[]> {
  const links = await tx.select(factSources, {
    columns: ["factId", "sourceRecordId"],
    where: inArray(
      factSources.factId,
      rows.map((row) => row.id),
    ),
  });
  const recordIds = [...new Set(links.map((link) => link.sourceRecordId))];
  const records =
    recordIds.length === 0
      ? []
      : await tx.select(sourceRecords, {
          columns: ["id", "occurredAt", "fromInside"],
          where: inArray(sourceRecords.id, recordIds),
        });
  const wide =
    recordIds.length === 0
      ? []
      : await tx.select(sourceRecords, {
          columns: ["id"],
          where: and(
            inArray(sourceRecords.id, recordIds),
            recordCompanyWide(orgId, companyWide, sql`${sourceRecords.id}`),
          ),
        });
  const wideIds = new Set(wide.map((record) => record.id));
  return rows.map((row) => {
    const sources = links
      .filter((link) => link.factId === row.id)
      .flatMap((link) => records.find((record) => record.id === link.sourceRecordId) ?? []);
    const times = sources.map((record) => record.occurredAt.getTime());
    return {
      row,
      inside: sources.some((record) => record.fromInside),
      companyWide: sources.some((record) => wideIds.has(record.id)),
      firstStated: times.length === 0 ? undefined : new Date(Math.min(...times)),
    };
  });
}
