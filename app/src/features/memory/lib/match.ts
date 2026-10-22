// Matching the objects an item states to the objects memory already holds (ADR-0022), before
// they're stored. An exact key (an email address, a domain) is the object. Otherwise memory
// looks for candidates of the same kind: objects with a similar name (trigram similarity), and
// objects with a fact that means nearly the same as one the item states about it (stored
// embeddings). A `fast` model call confirms or rejects each candidate, best first, and the
// first it confirms is the object; a similar name alone never merges, and an object no
// candidate is confirmed for is new. Every query runs through `forOrg`, so nothing is ever
// matched across companies.
import { and, cosineDistance, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { forOrg, type OrgScopedDb } from "@/db/for-org";
import { callModel } from "@/features/models/server";
import type { Ctx } from "@/lib/ctx";
import { joinPrompts, type PromptText } from "@/lib/prompts";
import { MEMORY_USAGE } from "./budget";
import type { Extracted, ExtractedObject } from "./extract";
import { matchPrompts } from "./prompts";
import { facts, memoryObjects, objectKeys } from "./schema";

/** The most candidates confirmed for one object: each is a model call. */
const MAX_CANDIDATES = 3;
/**
 * How alike a stored fact's embedding must be to one the item states (cosine similarity) for
 * its subject to be a candidate: stricter than search's, since each candidate costs a call.
 */
export const MIN_CANDIDATE_SIMILARITY = 0.75;
// The facts about each side the confirmation sees.
const MAX_FACTS_SHOWN = 10;

/** The existing object each extracted object (by ref) is, if any; the rest are new. */
export type Matches = Map<string, string>;

type MemoryObjectRow = typeof memoryObjects.$inferSelect;

/** Matches the item's objects. `embeddings` match `extracted.facts`. */
export async function matchObjects(
  ctx: Ctx,
  extracted: Extracted,
  embeddings: number[][],
): Promise<Matches> {
  const db = forOrg(ctx);
  const matches: Matches = new Map();
  for (const object of extracted.objects) {
    const taken = new Set(matches.values());
    const exact = await byKey(db, object);
    if (exact !== undefined) {
      matches.set(object.ref, exact);
      continue;
    }
    const stated = extracted.facts.flatMap((fact, i) =>
      fact.about === object.ref ? [{ statement: fact.statement, embedding: embeddings[i] }] : [],
    );
    const candidates = (await candidatesFor(db, object, stated)).filter(
      (candidate) => !taken.has(candidate.id),
    );
    for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
      const statements = stated.map((fact) => fact.statement);
      if (await isSameObject(ctx, db, { ...object, statements }, candidate)) {
        matches.set(object.ref, candidate.id);
        break;
      }
    }
  }
  return matches;
}

async function byKey(db: OrgScopedDb, object: ExtractedObject): Promise<string | undefined> {
  if (object.keys.length === 0) return undefined;
  const found = await db.select(objectKeys, {
    where: or(
      ...object.keys.map((key) =>
        and(eq(objectKeys.kind, key.kind), eq(objectKeys.value, key.value)),
      ),
    ),
  });
  // The first of the object's keys that's known, as the item lists them.
  for (const key of object.keys) {
    const row = found.find((row) => row.kind === key.kind && row.value === key.value);
    if (row !== undefined) return row.objectId;
  }
  return undefined;
}

/** Candidates of the object's kind: similar names first, then similar facts' subjects. */
async function candidatesFor(
  db: OrgScopedDb,
  object: ExtractedObject,
  stated: { embedding: number[] | undefined }[],
): Promise<MemoryObjectRow[]> {
  const similarity = sql`similarity(${memoryObjects.name}, ${object.name})`;
  const named = await db.select(memoryObjects, {
    // `%`: trigram similarity at least pg_trgm's threshold (0.3), through the trigram index.
    where: and(eq(memoryObjects.kind, object.kind), sql`${memoryObjects.name} % ${object.name}`),
    orderBy: [desc(similarity), memoryObjects.id],
    limit: MAX_CANDIDATES,
  });

  const near: string[] = [];
  for (const { embedding } of stated) {
    if (embedding === undefined) continue;
    const distance = cosineDistance(facts.embedding, embedding);
    const rows = await db.select(facts, {
      where: and(isNull(facts.supersededAt), lte(distance, 1 - MIN_CANDIDATE_SIMILARITY)),
      orderBy: [distance, facts.id],
      limit: MAX_CANDIDATES * 2,
    });
    near.push(...rows.map((fact) => fact.subjectId));
  }
  const meant =
    near.length === 0
      ? []
      : await db.select(memoryObjects, {
          where: and(eq(memoryObjects.kind, object.kind), inArray(memoryObjects.id, near)),
        });
  const byMeaning = [...new Set(near)].flatMap((id) => meant.find((row) => row.id === id) ?? []);

  const both = [...named, ...byMeaning];
  return both.filter((row, i) => both.findIndex((other) => other.id === row.id) === i);
}

const confirmationSchema = z.object({
  same: z.boolean().describe(matchPrompts.same()),
});

/** Asks `fast` whether the item's object and the candidate are one, from what each is known by. */
async function isSameObject(
  ctx: Ctx,
  db: OrgScopedDb,
  object: ExtractedObject & { statements: string[] },
  candidate: MemoryObjectRow,
): Promise<boolean> {
  const keys = await db.select(objectKeys, { where: eq(objectKeys.objectId, candidate.id) });
  const known = await db.select(facts, {
    where: and(eq(facts.subjectId, candidate.id), isNull(facts.supersededAt)),
    orderBy: [desc(facts.recordedAt), facts.id],
    limit: MAX_FACTS_SHOWN,
  });
  const { output } = await callModel(ctx, "fast", {
    system: matchPrompts.system({ kind: object.kind }),
    prompt: matchPrompts.prompt({
      new: describe(object.name, object.keys, object.statements),
      existing: describe(
        candidate.name,
        keys,
        known.map((fact) => fact.statement),
      ),
    }),
    schema: confirmationSchema,
    ...MEMORY_USAGE,
  });
  return output.same;
}

function describe(
  name: string,
  keys: { kind: string; value: string }[],
  statements: string[],
): PromptText {
  return joinPrompts(
    [
      matchPrompts.recordName({ name }),
      ...keys.map((key) => matchPrompts.recordKey({ kind: key.kind, value: key.value })),
      matchPrompts.recordFacts(),
      ...statements
        .slice(0, MAX_FACTS_SHOWN)
        .map((statement) => matchPrompts.recordFact({ statement })),
    ],
    "\n",
  );
}
