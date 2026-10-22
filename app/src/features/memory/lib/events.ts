// The Inngest events memory sends itself: an admin started it, so it learns what discovery had
// stored already; an item to learn, queued then or when a postponed item's month comes; an
// exclusion was added, so what it covers is forgotten; postponed items are due again; a person
// was forgotten, so they're swept again; a night's retention is due.
import { eventType } from "inngest";
import { z } from "zod";
import { inngest } from "@/lib/inngest";
import { MEMORY_APPS, type ItemToLearn } from "../types";

const org = z.object({ orgId: z.string().min(1) });

/** An admin confirmed the estimate and started memory: it queues what's stored already. */
export const memoryStarted = eventType("memory/started", { schema: org });

/** One item for memory to learn, queued by memory itself; learned like `discovery/item.stored`. */
export const itemQueued = eventType("memory/item.queued", {
  schema: z.object({
    orgId: z.string().min(1),
    connectionId: z.string().min(1),
    app: z.enum(MEMORY_APPS),
    sourceRef: z.string().min(1),
  }),
});

/** An admin added an exclusion: what memory learned from items it covers is forgotten. */
export const exclusionAdded = eventType("memory/exclusion.added", {
  schema: z.object({ orgId: z.string().min(1), exclusionId: z.string().min(1) }),
});

/** Items postponed for the budget are due again: a new month began, or the budget changed. */
export const postponedDue = eventType("memory/postponed.due", { schema: org });

/**
 * An admin forgot a person: the objects keyed by their address are deleted again once learning
 * in progress is done. The address is encrypted for the org (the key store), never plain.
 */
export const personForgotten = eventType("memory/person.forgotten", {
  schema: z.object({ orgId: z.string().min(1), address: z.string().min(1) }),
});

/** A night's retention is due for the org: what's past its window goes. */
export const retentionDue = eventType("memory/retention.due", { schema: org });

// Inngest takes up to 5,000 events a send; fewer keeps each request small.
const BATCH = 500;

/**
 * Queues items for learning. `idPrefix` makes a resend queue nothing new (Inngest drops an
 * event ID it saw in the last 24 hours); without it, every send queues them again.
 */
export async function sendItemsQueued(
  orgId: string,
  items: ItemToLearn[],
  idPrefix?: string,
): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH) {
    await inngest.send(
      items
        .slice(i, i + BATCH)
        .map((item) =>
          itemQueued.create(
            { orgId, connectionId: item.connectionId, app: item.app, sourceRef: item.sourceRef },
            idPrefix === undefined
              ? undefined
              : { id: `${idPrefix}-${item.connectionId}-${item.app}-${item.sourceRef}` },
          ),
        ),
    );
  }
}

export async function sendMemoryStarted(orgId: string): Promise<void> {
  await inngest.send(memoryStarted.create({ orgId }));
}

export async function sendExclusionAdded(orgId: string, exclusionId: string): Promise<void> {
  await inngest.send(exclusionAdded.create({ orgId, exclusionId }));
}

export async function sendPersonForgotten(orgId: string, address: string): Promise<void> {
  await inngest.send(personForgotten.create({ orgId, address }));
}

export async function sendRetentionDue(orgIds: string[]): Promise<void> {
  for (let i = 0; i < orgIds.length; i += BATCH) {
    await inngest.send(orgIds.slice(i, i + BATCH).map((orgId) => retentionDue.create({ orgId })));
  }
}

export async function sendPostponedDue(orgIds: string[]): Promise<void> {
  if (orgIds.length === 0) return;
  await inngest.send(orgIds.map((orgId) => postponedDue.create({ orgId })));
}
