// Memory's reads as its callers make them: each read, in the ctx's view, then logged as the
// reader the caller names (ADR-0024). A read that throws (an object the caller can't see) read
// nothing and logs nothing; a search that finds nothing is still logged.
import type { Ctx } from "@/lib/ctx";
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

export async function searchAs(
  ctx: Ctx,
  search: MemorySearch,
  reader: LoggedReader,
): Promise<MemorySearchResult> {
  const found = await searchVisibleMemory(ctx, search);
  await logRead(ctx, reader, {
    operation: "search",
    objectIds: found.objects.map((object) => object.id),
    factIds: found.facts.map((fact) => fact.id),
  });
  return found;
}
