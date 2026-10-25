// The events memory's jobs send from inside their steps, which Inngest retries: the items its
// start job queues, page by page, and the crons' fan-outs to every org. They save no change
// before sending, so a retried step sends the same again. What a change sends goes through the
// outbox with the change instead (ADR-0027).
import { inngest } from "@/lib/inngest";
import { itemQueued, postponedDue, retentionDue } from "../events";
import type { ItemToLearn, PostponeReason } from "../types";

// Inngest takes up to 5,000 events a send; fewer keeps each request small.
const BATCH = 500;

/**
 * Queues items for learning, under IDs starting `idPrefix`, so a resend queues nothing new
 * (Inngest drops an event ID it saw in the last 24 hours).
 */
export async function sendItemsQueued(
  orgId: string,
  items: ItemToLearn[],
  idPrefix: string,
): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH) {
    await inngest.send(
      items
        .slice(i, i + BATCH)
        .map((item) =>
          itemQueued.create(
            { orgId, connectionId: item.connectionId, app: item.app, sourceRef: item.sourceRef },
            { id: `${idPrefix}-${item.connectionId}-${item.app}-${item.sourceRef}` },
          ),
        ),
    );
  }
}

export async function sendRetentionDue(orgIds: string[]): Promise<void> {
  for (let i = 0; i < orgIds.length; i += BATCH) {
    await inngest.send(orgIds.slice(i, i + BATCH).map((orgId) => retentionDue.create({ orgId })));
  }
}

export async function sendPostponedDue(
  orgIds: string[],
  reasons?: PostponeReason[],
): Promise<void> {
  for (let i = 0; i < orgIds.length; i += BATCH) {
    await inngest.send(
      orgIds
        .slice(i, i + BATCH)
        .map((orgId) =>
          postponedDue.create(reasons === undefined ? { orgId } : { orgId, reasons }),
        ),
    );
  }
}
