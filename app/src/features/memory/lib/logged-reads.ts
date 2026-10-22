// Memory's reads as its callers make them: each read, in the ctx's view (or, for a company-wide
// search, the view an org-credential run has), then logged as the reader the caller names, with
// the ctx's user as the person reading (ADR-0024). A read that throws (an object the caller
// can't see) read nothing and logs nothing; a search that finds nothing is still logged.
import { systemCtx, type Ctx } from "@/lib/ctx";
import {
  memoryReaderSchema,
  type MemoryObject,
  type MemoryReader,
  type MemorySearch,
  type MemorySearchResult,
  type ObjectLookup,
} from "../types";
import { type LoggedReader, loggedReader, logRead } from "./access-log";
import { readObject as readVisibleObject } from "./read";
import { searchMemory as searchVisibleMemory } from "./search";

const PERSON: MemoryReader = { kind: "person" };

/** Reads one object with the facts the ctx can see, logged as `reader` (the person, by default). */
export async function readObject(
  ctx: Ctx,
  lookup: ObjectLookup,
  reader: MemoryReader = PERSON,
): Promise<MemoryObject> {
  return readObjectAs(ctx, lookup, loggedReader(ctx, memoryReaderSchema.parse(reader)));
}

/** Searches what the ctx can see, logged as `reader` (the person, by default). */
export async function searchMemory(
  ctx: Ctx,
  search: MemorySearch,
  reader: MemoryReader = PERSON,
): Promise<MemorySearchResult> {
  return searchAs(ctx, search, loggedReader(ctx, memoryReaderSchema.parse(reader)));
}

/**
 * Searches only what's company-wide (ADR-0023): org connections, company-wide lists, and docs
 * shared with the company's domain or anyone, as the org's system ctx sees them, whoever the
 * ctx is. Logged as `reader`, with the ctx's user as the person reading.
 */
export async function searchCompanyWideMemory(
  ctx: Ctx,
  search: MemorySearch,
  reader: MemoryReader = PERSON,
): Promise<MemorySearchResult> {
  const logged = loggedReader(ctx, memoryReaderSchema.parse(reader));
  return searchAs(ctx, search, logged, systemCtx(ctx.orgId));
}

export async function readObjectAs(
  ctx: Ctx,
  lookup: ObjectLookup,
  reader: LoggedReader,
): Promise<MemoryObject> {
  const object = await readVisibleObject(ctx, lookup);
  await logRead(ctx, reader, {
    operation: "read_object",
    objectIds: [object.id],
    // Its history is read too.
    factIds: [...object.facts, ...object.history].map((fact) => fact.id),
  });
  return object;
}

/** Searches in `view`'s view (the ctx's, by default), logged as `reader` with the ctx's user. */
export async function searchAs(
  ctx: Ctx,
  search: MemorySearch,
  reader: LoggedReader,
  view: Ctx = ctx,
): Promise<MemorySearchResult> {
  const found = await searchVisibleMemory(view, search);
  await logRead(ctx, reader, {
    operation: "search",
    objectIds: found.objects.map((object) => object.id),
    factIds: found.facts.map((fact) => fact.id),
  });
  return found;
}
