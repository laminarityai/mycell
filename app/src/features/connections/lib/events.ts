// The Inngest events the connections feature sends. Other features' jobs trigger on them.
import { eventType } from "inngest";
import { z } from "zod";
import type { Ctx } from "@/lib/ctx";
import { actorSchema } from "@/lib/ctx";
import { inngest } from "@/lib/inngest";

// Both events carry the connection and the ctx its backfill runs as.
const backfillDue = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1),
  role: actorSchema,
  connectionId: z.string().min(1),
});

/**
 * Sent when a connection is recorded, which starts its backfill. It carries the ctx of the
 * user who connected it, which the backfill runs as.
 */
export const connectionRecorded = eventType("connections/connection.recorded", {
  schema: backfillDue,
});

/**
 * Sent when a reconnect grants a connection an ingested app it didn't have (its owner allowed
 * Drive this time, say), or grants again an app whose backfill failed, which starts that app's
 * backfill. Nobody in Mycel is acting, so it carries the org's system ctx (ADR-0009).
 */
export const connectionAppsGranted = eventType("connections/apps.granted", {
  schema: backfillDue,
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

/**
 * Announces the apps a reconnect granted, named by the ingest states it started for them: each
 * grant's event ID is new, and a resend of the same grant is dropped.
 */
export async function sendAppsGranted(
  ctx: Ctx,
  connectionId: string,
  stateIds: string[],
): Promise<void> {
  await inngest.send(
    connectionAppsGranted.create(
      { orgId: ctx.orgId, userId: ctx.userId, role: ctx.role, connectionId },
      { id: `apps-granted-${[...stateIds].sort().join("-")}` },
    ),
  );
}
