// Storing normalized events and their object refs. Both inserts skip rows that already exist,
// so a retried page or a re-run backfill stores nothing twice, and a page that failed between
// the two inserts gets its refs on the retry.
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { ConnectionDetails, IngestedApp } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import type { NormalizedEvent } from "./connector";
import { events, objectRefs } from "./schema";

// Rows per object-ref insert, well under Postgres's 65,535 bind parameters.
const REF_CHUNK = 1000;

/** Stores what one app's connector found on the connection, as events from that app. */
export async function storeEvents(
  ctx: Ctx,
  connection: ConnectionDetails,
  app: IngestedApp,
  normalized: NormalizedEvent[],
): Promise<void> {
  if (normalized.length === 0) return;
  const db = forOrg(ctx);
  await db.insert(
    events,
    normalized.map((event) => ({
      id: randomUUID(),
      connectionId: connection.id,
      ownerScope: connection.kind,
      ownerUserId: connection.ownerUserId,
      source: app,
      sourceRef: event.sourceRef,
      type: event.type,
      occurredAt: event.occurredAt,
      actor: event.actor,
      counterparties: event.counterparties,
      direction: event.direction,
      threadId: event.threadId,
      attachments: event.attachments,
      labelIds: event.labelIds,
      mimeType: event.mimeType,
    })),
    { onConflictDoNothing: true },
  );
  const stored = await db.select(events, {
    where: and(
      eq(events.connectionId, connection.id),
      inArray(
        events.sourceRef,
        normalized.map((event) => event.sourceRef),
      ),
    ),
  });
  const idOf = new Map(stored.map((row) => [row.sourceRef, row.id]));
  const refs = normalized.flatMap((event) => {
    const eventId = idOf.get(event.sourceRef);
    if (eventId === undefined) return [];
    return event.objectRefs.map((ref) => ({
      id: randomUUID(),
      connectionId: connection.id,
      eventId,
      kind: ref.kind,
      key: ref.key,
    }));
  });
  for (let start = 0; start < refs.length; start += REF_CHUNK) {
    await db.insert(objectRefs, refs.slice(start, start + REF_CHUNK), {
      onConflictDoNothing: true,
    });
  }
}

/** When the latest event the connection stored from `app` occurred, or null if it has none. */
export async function latestEventTime(
  ctx: Ctx,
  connectionId: string,
  app: IngestedApp,
): Promise<Date | null> {
  const rows = await forOrg(ctx).select(events, {
    where: and(eq(events.connectionId, connectionId), eq(events.source, app)),
    orderBy: [desc(events.occurredAt)],
    limit: 1,
  });
  return rows.at(0)?.occurredAt ?? null;
}
