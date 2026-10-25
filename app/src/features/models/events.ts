// The Inngest event models sends itself: a failed call was recorded at 0 under a generation ID,
// so its billed cost is looked up a few minutes later. Written to the outbox with the usage entry
// (ADR-0027). A definition only, no IO: the outbox reads it to check what it sends.
import { eventType } from "inngest";
import { z } from "zod";

/** A failed call's usage entry whose billed cost is still to be looked up. Pointers only. */
export const failedCallRecorded = eventType("models/failed-call.recorded", {
  schema: z.object({ orgId: z.string().min(1), entryId: z.string().min(1) }),
});
