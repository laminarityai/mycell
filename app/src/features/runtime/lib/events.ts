// The Inngest events runtime sends itself.
import { eventType } from "inngest";
import { z } from "zod";
import { inngest } from "@/lib/inngest";

/** A run was recorded and is due to execute. `connectionId` keys the per-connection limit. */
export const runRequested = eventType("runtime/run.requested", {
  schema: z.object({
    orgId: z.string().min(1),
    runId: z.string().min(1),
    connectionId: z.string().min(1),
  }),
});

/** Asks for the run to execute. The event ID makes a resend start no second execution. */
export async function sendRunRequested(data: z.infer<typeof runRequested.schema>) {
  await inngest.send(runRequested.create(data, { id: `run-${data.runId}` }));
}
