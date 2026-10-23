// Reading events by the objects they refer to: the read later stages (mining, the builder chat)
// use to follow an object across messages and files.
import { and, asc, eq, inArray, or, type SQL } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { type Ctx, isAdmin } from "@/lib/ctx";
import type { IngestedEvent, ObjectRefKind } from "../types";
import { normalizeKey } from "./object-refs";
import { events, objectRefs } from "./schema";

/**
 * The events the caller may see that refer to the object `kind` / `key`, oldest first: those
 * from their own member connections and, for admins, from org connections. Never another
 * member's (ADR-0001). The key is matched exactly, after normalizing (emails are lowercased).
 */
export async function findEventsByObject(
  ctx: Ctx,
  kind: ObjectRefKind,
  key: string,
): Promise<IngestedEvent[]> {
  const db = forOrg(ctx);
  const refs = await db.select(objectRefs, {
    where: and(eq(objectRefs.kind, kind), eq(objectRefs.key, normalizeKey(kind, key))),
  });
  const eventIds = [...new Set(refs.map((ref) => ref.eventId))];
  if (eventIds.length === 0) return [];
  const rows = await db.select(events, {
    where: and(inArray(events.id, eventIds), visibleTo(ctx)),
    orderBy: [asc(events.occurredAt), asc(events.id)],
  });
  return rows.map((row) => ({
    id: row.id,
    connectionId: row.connectionId,
    ownerScope: row.ownerScope,
    source: row.source,
    sourceRef: row.sourceRef,
    type: row.type,
    occurredAt: row.occurredAt,
    actor: row.actor,
    counterparties: row.counterparties,
    direction: row.direction,
    threadId: row.threadId,
    attachments: row.attachments,
    labelIds: row.labelIds,
    mimeType: row.mimeType,
  }));
}

// The caller's own member-scoped events, plus org-scoped ones for admins.
function visibleTo(ctx: Ctx): SQL | undefined {
  const own = and(eq(events.ownerScope, "member"), eq(events.ownerUserId, ctx.userId));
  return isAdmin(ctx) ? or(own, eq(events.ownerScope, "org")) : own;
}
