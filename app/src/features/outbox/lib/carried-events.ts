// The events the outbox carries, by name. Writing any other is a bug, caught as it's written; the
// job checks what it sends against the same schemas, so a row stored in a shape that has since
// changed fails loudly instead of reaching a function. Each feature keeps its events in its own
// root `events.ts`, definitions only, so reading them here makes no import cycle with the
// features that write to the outbox.
import type { z } from "zod";
import {
  memoryStarted,
  exclusionAdded,
  itemQueued,
  personForgotten,
  postponedDue,
  toldFactDeleted,
} from "@/features/memory/events";
import { failedCallRecorded } from "@/features/models/events";
import { runRequested } from "@/features/runtime/events";
import { tagAssignmentRemoved, tagDeleted, tagRenamed } from "@/features/tags/events";
import { creditsGranted } from "@/lib/events";

/** An event type the outbox may carry: its name, and the Zod schema its data must fit. */
export type CarriedEvent = { name: string; schema: z.ZodType<Record<string, unknown>> };

const CARRIED: readonly CarriedEvent[] = [
  tagRenamed,
  tagDeleted,
  tagAssignmentRemoved,
  runRequested,
  memoryStarted,
  postponedDue,
  exclusionAdded,
  personForgotten,
  toldFactDeleted,
  itemQueued,
  failedCallRecorded,
  creditsGranted,
];

const byName = new Map(CARRIED.map((type) => [type.name, type]));

/** The carried event type with this name, or undefined for one the outbox doesn't carry. */
export function carriedEvent(name: string): CarriedEvent | undefined {
  return byName.get(name);
}
