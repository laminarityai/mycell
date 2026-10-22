// Memory's public types: what it learns from, what learning did, and an object as a reader sees
// it (ADR-0022).
import { z } from "zod";

/** The apps memory learns from. Drive and Calendar join with their tickets. */
export const MEMORY_APPS = ["gmail"] as const;
export type MemoryApp = (typeof MEMORY_APPS)[number];

/** The kinds of object memory holds. */
export const OBJECT_KINDS = ["person", "company", "deal", "project", "document"] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

/**
 * Exact identifiers an object is matched on, each unique in an org: a person's email address, a
 * company's domain. Drive file IDs and CRM IDs join later.
 */
export const OBJECT_KEY_KINDS = ["email", "domain"] as const;
export type ObjectKeyKind = (typeof OBJECT_KEY_KINDS)[number];

/** One item to learn from: what discovery's `discovery/item.stored` points at. */
export const itemToLearnSchema = z.object({
  connectionId: z.string().min(1),
  app: z.enum(MEMORY_APPS),
  sourceRef: z.string().min(1),
});
export type ItemToLearn = z.infer<typeof itemToLearnSchema>;

/**
 * Why learning skipped an item: learned already; the injection screen flagged it, or no screen
 * is configured, so no model read it; not business; or it stated no fact memory keeps.
 */
export type SkipReason = "known" | "flagged" | "unscreened" | "not_business" | "nothing_stated";

/**
 * What learning from one item did: stored facts about objects (a copy of an item learned
 * already reuses its facts), skipped it, or found its connection or the item gone.
 */
export type LearnOutcome =
  | { outcome: "learned"; objects: number; facts: number }
  | { outcome: "skipped"; reason: SkipReason }
  | { outcome: "gone" };

/** How a reader names an object: by its ID, or by one of its exact keys. */
export type ObjectLookup = { id: string } | { key: { kind: ObjectKeyKind; value: string } };

/** Where a fact came from: a pointer to re-fetch the item, never its content. */
export type FactSource = {
  app: MemoryApp;
  connectionId: string;
  sourceRef: string;
  occurredAt: Date;
};

/** A fact as one reader sees it: with only the sources that reader can see. */
export type MemoryFact = {
  id: string;
  statement: string;
  predicate: string | null;
  value: string | null;
  // The other object the fact links its subject to ("Dana works at Acme").
  linkedObject: { id: string; kind: ObjectKind; name: string } | null;
  // When it became true and stopped being true, as far as its sources say.
  validFrom: Date | null;
  validUntil: Date | null;
  // When memory recorded it.
  recordedAt: Date;
  sources: FactSource[];
};

/**
 * A fact a newer one replaced, as one reader sees it: `supersededBy` is the newer fact they can
 * see that replaced it, and `supersededAt` when memory recorded that.
 */
export type HistoricFact = MemoryFact & { supersededAt: Date; supersededBy: string };

/**
 * An object with the facts about it its reader can see: the current ones, and those a newer
 * fact the reader can see replaced (`history`). A fact replaced only by facts the reader can't
 * see is current for them.
 */
export type MemoryObject = {
  id: string;
  kind: ObjectKind;
  name: string;
  keys: { kind: ObjectKeyKind; value: string }[];
  facts: MemoryFact[];
  history: HistoricFact[];
};

/** The most facts one search returns. */
export const MAX_SEARCH_RESULTS = 50;

const searchLimit = z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional();

/**
 * A search of memory: by text (its words, and any email address or domain in it), or by one
 * exact key. `limit` caps the facts returned (20 by default).
 */
export const memorySearchSchema = z.union([
  z.object({ text: z.string().trim().min(1).max(500), limit: searchLimit }),
  z.object({
    key: z.object({
      kind: z.enum(OBJECT_KEY_KINDS),
      value: z.string().trim().toLowerCase().min(1).max(320),
    }),
    limit: searchLimit,
  }),
]);
export type MemorySearch = z.input<typeof memorySearchSchema>;

/** An object a search found, without its facts (`readObject` reads them). */
export type FoundObject = Omit<MemoryObject, "facts" | "history">;

/** A fact a search found, with the object it's about. */
export type FoundFact = MemoryFact & { subject: { id: string; kind: ObjectKind; name: string } };

/** What a search found that its caller can see, best match first. */
export type MemorySearchResult = { objects: FoundObject[]; facts: FoundFact[] };
