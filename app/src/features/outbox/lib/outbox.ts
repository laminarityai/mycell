// The outbox (ADR-0027): a change writes the events it sends in its own transaction, sends them
// right after the commit, and deletes each once Inngest has it. A send that fails leaves the
// event waiting, and the outbox job sends it a minute or so later. Every event has a fixed ID,
// so Inngest drops a copy of one it had already (in the last 24 hours), and every function an
// event starts is idempotent.
import { randomUUID } from "node:crypto";
import { and, asc, inArray, lt, notInArray } from "drizzle-orm";
import { forOrg, type OrgScopedDb } from "@/db/for-org";
import { type Ctx, requireSystem } from "@/lib/ctx";
import { InvariantError } from "@/lib/errors";
import { inngest } from "@/lib/inngest";
import type { Emit } from "../types";
import { carriedEvent } from "./carried-events";
import { outbox } from "./schema";
import { now as clockNow } from "@/lib/time";

/** How old a waiting event is before the job sends it: the action's own send has had its go. */
export const WAIT_MS = 60_000;

// Inngest takes up to 5,000 events a send; fewer keeps each request small.
const BATCH = 500;

type OutboxEvent = { name: string; data: Record<string, unknown>; id: string };

/**
 * Runs `save` in one transaction, writing the events it emits to the outbox in the same
 * transaction, then sends them. A failed send doesn't fail the save: the change and its events
 * are saved, and the outbox job sends them. Returns what `save` returns.
 */
export async function saveWithEvents<R>(
  ctx: Ctx,
  save: (tx: OrgScopedDb, emit: Emit) => Promise<R>,
): Promise<R> {
  const events = new Map<string, OutboxEvent>();
  const emit: Emit = (type, data, id) => {
    events.set(id, checked(type.name, data, id));
  };
  const result = await forOrg(ctx).transaction(async (tx) => {
    const saved = await save(tx, emit);
    if (events.size > 0) {
      const writtenAt = clockNow();
      await tx.insert(
        outbox,
        [...events.values()].map(({ name, data, id }) => ({
          id: randomUUID(),
          name,
          data,
          eventId: id,
          writtenAt,
        })),
        { onConflictDoNothing: true },
      );
    }
    return saved;
  });
  if (events.size > 0) await sendRightAway(ctx, [...events.values()]);
  return result;
}

// The send right after the commit. Inngest's event API failing leaves the events waiting.
async function sendRightAway(ctx: Ctx, events: OutboxEvent[]): Promise<void> {
  try {
    await deliver(ctx, events);
  } catch {
    const names = [...new Set(events.map((event) => event.name))].join(", ");
    console.warn(`Sending ${names} failed after its change was saved; the outbox job sends it.`);
  }
}

/**
 * Sends the org's events that have waited more than a minute at `now`, oldest first, and
 * deletes each once Inngest has it: the outbox job, as each org's system ctx. A failed send
 * throws, for the job's step to retry; an event that no longer fits its schema stays, and is
 * InvariantError once the rest are sent.
 */
export async function sendWaitingEvents(ctx: Ctx, now = clockNow()): Promise<{ sent: number }> {
  requireSystem(ctx);
  const db = forOrg(ctx);
  const before = new Date(now.getTime() - WAIT_MS);
  const broken: { rowId: string; what: string }[] = [];
  let sent = 0;
  for (;;) {
    const rows = await db.select(outbox, {
      where: and(
        lt(outbox.writtenAt, before),
        broken.length === 0
          ? undefined
          : notInArray(
              outbox.id,
              broken.map((row) => row.rowId),
            ),
      ),
      orderBy: [asc(outbox.writtenAt), asc(outbox.id)],
      limit: BATCH,
    });
    const events: OutboxEvent[] = [];
    for (const row of rows) {
      try {
        events.push(checked(row.name, row.data, row.eventId));
      } catch (error) {
        if (!(error instanceof InvariantError)) throw error;
        broken.push({ rowId: row.id, what: `${row.name} (${row.eventId})` });
      }
    }
    await deliver(ctx, events);
    sent += events.length;
    if (rows.length < BATCH) break;
  }
  if (broken.length > 0) {
    const list = broken.map((row) => row.what).join(", ");
    throw new InvariantError(`Waiting events no longer fit their schemas: ${list}.`);
  }
  return { sent };
}

// Sends the events, a batch at a time, deleting each batch's rows once Inngest has them.
async function deliver(ctx: Ctx, events: OutboxEvent[]): Promise<void> {
  for (let i = 0; i < events.length; i += BATCH) {
    const batch = events.slice(i, i + BATCH);
    await inngest.send(batch.map(({ name, data, id }) => ({ name, data, id })));
    await forOrg(ctx).deleteCount(
      outbox,
      inArray(
        outbox.eventId,
        batch.map((event) => event.id),
      ),
    );
  }
}

// The event, its data checked by its type's schema: InvariantError, a bug, for an event the
// outbox doesn't carry or data that doesn't fit.
function checked(name: string, data: unknown, id: string): OutboxEvent {
  const type = carriedEvent(name);
  if (type === undefined) {
    throw new InvariantError(`The outbox doesn't carry ${name}: add it to its carried events.`);
  }
  if (id.trim() === "") throw new InvariantError(`An event ${name} has no ID.`);
  const parsed = type.schema.safeParse(data);
  if (!parsed.success) throw new InvariantError(`The data of ${name} (${id}) doesn't fit it.`);
  return { name, data: parsed.data, id };
}
