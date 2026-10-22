// Searching memory (ADR-0022): the objects and current facts the caller can see, best match
// first, with no model call. The query is never embedded, since embedding it would be a model
// call with a ledger entry. Instead a search ranks facts on up to three lists and fuses them by
// weighted reciprocal rank:
// - keywords: facts whose keyword index matches any word of the text (English stemming);
// - links: facts about, or linking to, the objects the search names, by an exact key (an email
//   address or domain, given as the key or found in the text) or by a word of their name;
// - meaning: for a text search, facts the first two lists missed whose stored embeddings lie
//   closest to the best few facts they found, so a fact that shares no word with the text but
//   means the same as a match is found too.
// Facts about an object named by its exact key come first. Only facts the caller can see (the
// one visibility rule, applied in each list's query before it's limited), and of those only the
// ones current for them (the newest they can see of each timeline), rank or seed anything, so a
// fact they can't see never crowds out, pulls in, pushes down or replaces one they can.
import { and, cosineDistance, desc, eq, inArray, lte, ne, or, sql } from "drizzle-orm";
import { forOrg, type OrgScopedDb } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { emailAddressesIn } from "@/lib/email-addresses";
import {
  memorySearchSchema,
  type FoundObject,
  type MemorySearch,
  type MemorySearchResult,
  type ObjectKeyKind,
} from "../types";
import { facts, memoryObjects, objectKeys } from "./schema";
import { describeFacts, type FactRow, overTime, type SeenFact, seenFacts } from "./visible-facts";
import { type Reading, readingOf, viewerOf, visibleFact, visibleObject } from "./visibility";

const DEFAULT_LIMIT = 20;
// How many facts the keyword and link lists rank at most.
const CANDIDATES = 100;
// How many of the best facts seed the meaning list, and how many neighbours each brings.
const SEEDS = 3;
const NEIGHBOURS = 10;
/** How alike two facts' embeddings must be (cosine similarity) to count as meaning the same. */
export const MIN_SIMILARITY = 0.5;
// Reciprocal rank fusion: a fact scores the sum, over the lists it's on, of the list's weight
// / (RRF_K + its rank). A name match is weak evidence on its own, and a neighbour is found only
// through another match, so both count for less than a keyword match.
const RRF_K = 60;
const WEIGHTS = { keyword: 1, links: 0.25, meaning: 0.5 };
// The most words of a text that are searched.
const MAX_WORDS = 32;

type Key = { kind: ObjectKeyKind; value: string };
type Ranked = { facts: FactRow[]; weight: number };

export async function searchMemory(ctx: Ctx, input: MemorySearch): Promise<MemorySearchResult> {
  const search = memorySearchSchema.parse(input);
  const db = forOrg(ctx);
  const viewer = await viewerOf(ctx);
  const reading = await readingOf(ctx, viewer);
  const words = "text" in search ? wordsOf(search.text) : [];
  const keys = "key" in search ? [search.key] : keysIn(search.text);

  const { byKey, named } = await namedObjects(db, reading, keys, words);
  const keyword = await keywordFacts(db, reading, words);
  const linked = await linkedFacts(db, reading, named);
  const candidates = unique([...keyword, ...linked]);
  const seen = new Map<string, SeenFact>();
  // Only the facts current for the viewer: the newest of each timeline they can see.
  const see = async (rows: FactRow[]) => {
    const { current } = await overTime(ctx, viewer, await seenFacts(ctx, viewer, rows));
    for (const found of current) seen.set(found.fact.id, found);
    return rows.filter((fact) => seen.has(fact.id));
  };
  await see(candidates);
  const lists: Ranked[] = [
    { facts: keyword.filter((fact) => seen.has(fact.id)), weight: WEIGHTS.keyword },
    { facts: linked.filter((fact) => seen.has(fact.id)), weight: WEIGHTS.links },
  ];
  if ("text" in search) {
    const seeds = fuse(lists)
      .slice(0, SEEDS)
      .flatMap((id) => seen.get(id)?.fact ?? []);
    const near = await neighbours(db, reading, seeds, new Set(candidates.map((fact) => fact.id)));
    lists.push({ facts: await see(near), weight: WEIGHTS.meaning });
  }

  const fused = fuse(lists).flatMap((id) => seen.get(id) ?? []);
  const isKeyed = ({ fact }: SeenFact) => byKey.includes(fact.subjectId);
  const ranked = [...fused.filter(isKeyed), ...fused.filter((found) => !isKeyed(found))];
  return found(ctx, ranked.slice(0, search.limit ?? DEFAULT_LIMIT), named);
}

/** The text's distinct words, lowercased: letters and digits only, so never query syntax. */
function wordsOf(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0, MAX_WORDS);
}

/** The email addresses and domains in a text, as object keys. */
function keysIn(text: string): Key[] {
  const lower = text.toLowerCase();
  const emails = emailAddressesIn(lower);
  const withoutEmails = emails.reduce((rest, email) => rest.replace(email, " "), lower);
  const domains = withoutEmails.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/g) ?? [];
  return [
    ...emails.map((value) => ({ kind: "email" as const, value })),
    ...[...new Set(domains)].map((value) => ({ kind: "domain" as const, value })),
  ];
}

// Any of the words, as a tsquery the keyword index answers. Stop words drop out.
const anyOf = (words: string[]) => sql`to_tsquery('english', ${words.join(" | ")})`;

/**
 * The objects the search names by an exact key (`byKey`), and those first, then the ones the
 * caller can see whose name a word matches (`named`).
 */
async function namedObjects(db: OrgScopedDb, reading: Reading, keys: Key[], words: string[]) {
  const keyRows =
    keys.length === 0
      ? []
      : await db.select(objectKeys, {
          where: or(
            ...keys.map((key) =>
              and(eq(objectKeys.kind, key.kind), eq(objectKeys.value, key.value)),
            ),
          ),
        });
  const nameIndex = sql`to_tsvector('english', ${memoryObjects.name})`;
  const byName =
    words.length === 0
      ? []
      : await db.select(memoryObjects, {
          where: and(sql`${nameIndex} @@ ${anyOf(words)}`, visibleObject(reading)),
          orderBy: [desc(sql`ts_rank_cd(${nameIndex}, ${anyOf(words)})`), memoryObjects.id],
          limit: CANDIDATES,
        });
  const byKey = unique(keyRows.map((key) => key.objectId));
  return { byKey, named: unique([...byKey, ...byName.map((object) => object.id)]) };
}

/** Facts the caller can see whose keyword index matches any of the words, best match first. */
async function keywordFacts(
  db: OrgScopedDb,
  reading: Reading,
  words: string[],
): Promise<FactRow[]> {
  if (words.length === 0) return [];
  return db.select(facts, {
    where: and(sql`${facts.keywords} @@ ${anyOf(words)}`, visibleFact(reading)),
    orderBy: [desc(sql`ts_rank_cd(${facts.keywords}, ${anyOf(words)})`), desc(facts.recordedAt)],
    limit: CANDIDATES,
  });
}

/**
 * Facts the caller can see about the objects, then those linking another object to them, in
 * the objects' order, newest first.
 */
async function linkedFacts(
  db: OrgScopedDb,
  reading: Reading,
  objectIds: string[],
): Promise<FactRow[]> {
  if (objectIds.length === 0) return [];
  const rows = await db.select(facts, {
    where: and(
      or(inArray(facts.subjectId, objectIds), inArray(facts.objectId, objectIds)),
      visibleFact(reading),
    ),
    orderBy: [desc(facts.recordedAt), facts.id],
    limit: CANDIDATES,
  });
  const order = (fact: FactRow) => {
    const about = objectIds.indexOf(fact.subjectId);
    return about >= 0 ? about : objectIds.length + objectIds.indexOf(fact.objectId ?? "");
  };
  return rows.toSorted((a, b) => order(a) - order(b));
}

/**
 * Facts the caller can see, other than `known` ones, whose stored embeddings mean nearly the
 * same as a seed's: every seed's closest first, then every seed's second closest, and so on.
 */
async function neighbours(
  db: OrgScopedDb,
  reading: Reading,
  seeds: FactRow[],
  known: Set<string>,
): Promise<FactRow[]> {
  const perSeed = await Promise.all(
    seeds.map((seed) => {
      const distance = cosineDistance(facts.embedding, seed.embedding);
      return db.select(facts, {
        where: and(ne(facts.id, seed.id), lte(distance, 1 - MIN_SIMILARITY), visibleFact(reading)),
        orderBy: [distance, facts.id],
        limit: NEIGHBOURS,
      });
    }),
  );
  const interleaved = Array.from({ length: NEIGHBOURS }, (_, rank) =>
    perSeed.flatMap((near) => near[rank] ?? []),
  ).flat();
  return unique(interleaved.filter((fact) => !known.has(fact.id)));
}

/**
 * Weighted reciprocal rank fusion: fact IDs by their summed weight / (RRF_K + rank) over the
 * lists, ties in the order they were first ranked.
 */
function fuse(lists: Ranked[]): string[] {
  const scores = new Map<string, number>();
  for (const { facts: list, weight } of lists) {
    for (const [rank, fact] of list.entries()) {
      scores.set(fact.id, (scores.get(fact.id) ?? 0) + weight / (RRF_K + rank + 1));
    }
  }
  return [...scores.entries()].toSorted((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** The result: the facts, and the objects they're about, the ones the search named first. */
async function found(ctx: Ctx, ranked: SeenFact[], named: string[]): Promise<MemorySearchResult> {
  const db = forOrg(ctx);
  const subjectIds = unique(ranked.map(({ fact }) => fact.subjectId));
  const objectIds = [
    ...named.filter((id) => subjectIds.includes(id)),
    ...subjectIds.filter((id) => !named.includes(id)),
  ];
  if (objectIds.length === 0) return { objects: [], facts: [] };
  const rows = await db.select(memoryObjects, { where: inArray(memoryObjects.id, objectIds) });
  const keys = await db.select(objectKeys, {
    where: inArray(objectKeys.objectId, objectIds),
    orderBy: [objectKeys.kind, objectKeys.value],
  });
  const objects = objectIds.flatMap((id): FoundObject[] => {
    const object = rows.find((row) => row.id === id);
    if (object === undefined) return [];
    const its = keys.filter((key) => key.objectId === id);
    return [
      {
        id,
        kind: object.kind,
        name: object.name,
        keys: its.map(({ kind, value }) => ({ kind, value })),
      },
    ];
  });
  const described = await describeFacts(ctx, ranked);
  return {
    objects,
    facts: described.flatMap((fact, i) => {
      const subject = objects.find((object) => object.id === ranked[i]?.fact.subjectId);
      return subject === undefined
        ? []
        : [{ ...fact, subject: { id: subject.id, kind: subject.kind, name: subject.name } }];
    }),
  };
}

function unique<T extends string | { id: string }>(items: T[]): T[] {
  const ids = new Set<string>();
  return items.filter((item) => {
    const id = typeof item === "string" ? item : item.id;
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  });
}
