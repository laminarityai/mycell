// The Inngest events the connections feature sends. Other features' jobs trigger on them.
import { eventType } from "inngest";
import { z } from "zod";
import type { Ctx } from "@/lib/ctx";
import { actorSchema } from "@/lib/ctx";
import { inngest } from "@/lib/inngest";

/**
 * Sent when a connection is recorded, which starts its backfill. It carries the ctx of the
 * user who connected it, which the backfill runs as.
 */
export const connectionRecorded = eventType("connections/connection.recorded", {
  schema: z.object({
    orgId: z.string().min(1),
    userId: z.string().min(1),
    role: actorSchema,
    connectionId: z.string().min(1),
  }),
});

/**
 * Announces a recorded connection. The event ID makes a resend (Nango redelivering the
 * creation webhook) start no second backfill: Inngest drops an ID it has seen in 24 hours.
 */
export async function sendConnectionRecorded(ctx: Ctx, connectionId: string): Promise<void> {
  await inngest.send(
    connectionRecorded.create(
      { orgId: ctx.orgId, userId: ctx.userId, role: ctx.role, connectionId },
      { id: `connection-recorded-${connectionId}` },
    ),
  );
}
