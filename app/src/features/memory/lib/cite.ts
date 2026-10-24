// Citing facts a reader already read (Ask Mycel's footnotes, M9): for each fact the reader can
// see now, the sources they can see and its markers, never what it says. A reply keeps only the
// IDs of the facts it read (invariant 8), so its page asks again where they came from each time
// it's shown, in the reader's own view: a fact since deleted, or no longer visible to them, has
// no citation. It isn't logged as a read: it returns no statement and no object, and the facts
// were logged when the reply read them (ADR-0024).
import { inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import type { FactCitation } from "../types";
import { facts } from "./schema";
import { readingOf } from "./visibility";
import { seenFacts, visibleFacts } from "./visible-facts";

export async function citeFacts(ctx: Ctx, factIds: string[]): Promise<FactCitation[]> {
  const ids = [...new Set(factIds)];
  if (ids.length === 0) return [];
  const rows = await forOrg(ctx).select(facts, {
    columns: ["id", "conflictsWithId", "toldByUserId", "deletedAt"],
    where: inArray(facts.id, ids),
  });
  const reading = await readingOf(ctx);
  const seen = await seenFacts(ctx, reading, rows);
  // The fact it contradicts, only when the reader can see that one too.
  const conflicting = await visibleFacts(
    ctx,
    reading,
    seen.flatMap(({ fact }) => fact.conflictsWithId ?? []),
  );
  return seen.map(({ fact, sources, outsideOnly }) => ({
    id: fact.id,
    sources,
    conflictsWith:
      fact.conflictsWithId !== null && conflicting.has(fact.conflictsWithId)
        ? fact.conflictsWithId
        : null,
    outsideOnly,
    told: fact.toldByUserId !== null,
  }));
}
