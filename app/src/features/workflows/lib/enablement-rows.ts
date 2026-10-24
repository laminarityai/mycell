// Writing the caller's own enablement row, after whoever calls this has checked they may.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { isUniqueViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { now } from "@/lib/time";
import { enablements } from "./schema";

/**
 * Switches the caller's enablement of the workflow on for `connectionId`, from now on: messages
 * that arrived earlier start nothing. One already on for that connection is left as it is; a
 * paused one, or one on another connection, is switched on there from now.
 */
export async function switchOnEnablement(
  ctx: Ctx,
  workflowId: string,
  connectionId: string,
): Promise<void> {
  const db = forOrg(ctx);
  const mine = and(eq(enablements.workflowId, workflowId), eq(enablements.userId, ctx.userId));
  const existing = (await db.select(enablements, { where: mine, limit: 1 })).at(0);
  if (existing?.connectionId === connectionId && existing.status === "on") return;
  if (existing !== undefined) {
    await db.update(
      enablements,
      {
        connectionId,
        status: "on",
        pausedReason: null,
        pausedChange: null,
        enabledAt: now(),
      },
      mine,
    );
    return;
  }
  try {
    await db.insert(enablements, {
      id: randomUUID(),
      workflowId,
      userId: ctx.userId,
      connectionId,
      // Set here rather than by the column's default: it's compared with messages' times,
      // which are written from JS too.
      enabledAt: now(),
    });
  } catch (error) {
    // Switched on twice at once: the other switch-on won, and it's on.
    if (!isUniqueViolation(error, "enablements_workflow_id_user_id_unique")) throw error;
  }
}

/** Switches the caller's enablement of the workflow off: the row goes. */
export async function deleteEnablement(ctx: Ctx, workflowId: string): Promise<void> {
  await forOrg(ctx).delete(
    enablements,
    and(eq(enablements.workflowId, workflowId), eq(enablements.userId, ctx.userId)),
  );
}
