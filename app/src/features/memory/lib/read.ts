// Reading one object with the facts its reader can see, current and history, each with only
// the sources that reader can see. An object the reader can see no fact about is NotFoundError,
// as is one in another org: an ID or a key tells them nothing.
import { and, asc, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import type { MemoryObject, ObjectLookup } from "../types";
import { facts, memoryObjects, objectKeys } from "./schema";
import { describeFacts, describeHistory, overTime, seenFacts } from "./visible-facts";
import { viewerOf } from "./visibility";

export async function readObject(ctx: Ctx, lookup: ObjectLookup): Promise<MemoryObject> {
  const db = forOrg(ctx);
  const object = await findObject(ctx, lookup);
  if (object === undefined) throw new NotFoundError("object");

  const about = await db.select(facts, {
    where: eq(facts.subjectId, object.id),
    orderBy: [asc(facts.recordedAt), asc(facts.id)],
  });
  const viewer = await viewerOf(ctx);
  const { current, history } = await overTime(ctx, viewer, await seenFacts(ctx, viewer, about));
  if (current.length === 0) throw new NotFoundError("object");

  const keys = await db.select(objectKeys, {
    where: eq(objectKeys.objectId, object.id),
    orderBy: [asc(objectKeys.kind), asc(objectKeys.value)],
  });
  return {
    id: object.id,
    kind: object.kind,
    name: object.name,
    keys: keys.map(({ kind, value }) => ({ kind, value })),
    facts: await describeFacts(ctx, current),
    history: await describeHistory(ctx, history),
  };
}

async function findObject(ctx: Ctx, lookup: ObjectLookup) {
  const db = forOrg(ctx);
  let id: string;
  if ("id" in lookup) {
    id = lookup.id;
  } else {
    const key = (
      await db.select(objectKeys, {
        where: and(
          eq(objectKeys.kind, lookup.key.kind),
          eq(objectKeys.value, lookup.key.value.trim().toLowerCase()),
        ),
      })
    ).at(0);
    if (key === undefined) return undefined;
    id = key.objectId;
  }
  const object = (await db.select(memoryObjects, { where: eq(memoryObjects.id, id) })).at(0);
  return object;
}
