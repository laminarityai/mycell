// The Inngest event models sends itself: a failed call was recorded at 0 under a generation ID,
// so its billed cost is looked up a few minutes later.
import { eventType } from "inngest";
import { z } from "zod";
import { inngest } from "@/lib/inngest";

/** A failed call's usage entry whose billed cost is still to be looked up. Pointers only. */
export const failedCallRecorded = eventType("models/failed-call.recorded", {
  schema: z.object({ orgId: z.string().min(1), entryId: z.string().min(1) }),
});

/** Queues the lookup. The event ID makes a resent entry queue nothing new. */
export async function sendFailedCallRecorded(orgId: string, entryId: string): Promise<void> {
  await inngest.send(
    failedCallRecorded.create({ orgId, entryId }, { id: `failed-call-${entryId}` }),
  );
}
