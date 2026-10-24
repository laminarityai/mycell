// The Inngest events memory sends itself: an admin started it, so it learns what discovery had
// stored already; an item to learn, queued then or when a postponed item's month comes; an
// exclusion was added, so what it covers is forgotten; postponed items are due again; a person
// was forgotten, so they're swept again; a night's retention is due. Those a change sends are
// written to the outbox with it (ADR-0027). Definitions only, no IO: the outbox reads them to
// check what it sends.
import { eventType } from "inngest";
import { z } from "zod";
import { MEMORY_APPS, POSTPONE_REASONS } from "./types";

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

/**
 * Items postponed are due again: for the budget, a new month began or the budget changed (every
 * reason then); for the injection screen, the hourly retry. Credits granted resume their own
 * (`credits/granted`).
 */
export const postponedDue = eventType("memory/postponed.due", {
  schema: z.object({
    orgId: z.string().min(1),
    reasons: z.array(z.enum(POSTPONE_REASONS)).optional(),
  }),
});

/**
 * An admin forgot a person: the objects keyed by their address are deleted again once learning
 * in progress is done. The address is encrypted for the org (the key store), never plain.
 */
export const personForgotten = eventType("memory/person.forgotten", {
  schema: z.object({ orgId: z.string().min(1), address: z.string().min(1) }),
});

/** A night's retention is due for the org: what's past its window goes. */
export const retentionDue = eventType("memory/retention.due", { schema: org });
