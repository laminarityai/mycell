// The triggers' fan-out: one new inbound message, or one new invite, on a connection starts one
// run of each enablement and org workflow switched on for that connection with that trigger,
// pinned to the workflow's latest version. A run is unique on (enablement or org workflow,
// message or invite), so a resent trigger event, or an invite seen again, starts nothing twice.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { isForeignKeyViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { getConnection } from "@/features/connections/server";
import type { ConnectionDetails } from "@/features/connections/types";
import { listStartable } from "@/features/workflows/server";
import type { SwitchedOn } from "@/features/workflows/types";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { GmailMessageReceived } from "@/lib/events";
import { sendRunRequested, type CalendarInviteReceived } from "./events";
import { runs } from "./schema";

// A run can't be recorded once its connection or enablement is gone: it then starts nothing.
const GONE_FOREIGN_KEYS = ["runs_connection_fk", "runs_enablement_fk"];

/**
 * Records and requests the runs `message` starts, as the org's system ctx (ADR-0009), and
 * returns their IDs. Only switches whose trigger is a new Gmail message start one: a message
 * that occurred before a switch-on, or carries none of its trigger's labels, starts nothing for
 * that switch.
 */
export async function startTriggeredRuns(
  ctx: Ctx,
  message: GmailMessageReceived,
): Promise<{ runIds: string[] }> {
  return startRuns(ctx, message, ({ trigger }) =>
    trigger.type === "gmail.message_received"
      ? trigger.labelIds.some((label) => message.labelIds.includes(label))
      : false,
  );
}

/**
 * Records and requests the runs a new invite on a connection's calendar starts, as the org's
 * system ctx, and returns their IDs: one per switch whose trigger is a new invite and that was
 * switched on at or before the invite was made.
 */
export async function startInviteRuns(
  ctx: Ctx,
  invite: CalendarInviteReceived,
): Promise<{ runIds: string[] }> {
  return startRuns(ctx, invite, ({ trigger }) => trigger.type === "calendar.invite_received");
}

/** What a trigger hands the fan-out: pointers only. */
type Triggered = { connectionId: string; sourceRef: string; occurredAt: string };

// The runs `item` starts on its connection: one per startable switch it `fits`.
async function startRuns(
  ctx: Ctx,
  item: Triggered,
  fits: (on: SwitchedOn) => boolean,
): Promise<{ runIds: string[] }> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const occurredAt = new Date(item.occurredAt);
  const due = (await listStartable(ctx, item.connectionId)).filter(
    (on) => occurredAt.getTime() >= on.since.getTime() && fits(on),
  );
  if (due.length === 0) return { runIds: [] };
  const connection = await connectionOrNull(ctx, item.connectionId);
  // Google refused its token: its switches stay as they are, and start runs again once its
  // owner reconnects.
  if (connection === null || connection.needsReauth) return { runIds: [] };

  const runIds: string[] = [];
  for (const on of due) {
    const run = await recordRun(ctx, connection, on, item.sourceRef);
    if (run === null) continue;
    // Requested again for a run recorded already, in case the first request was lost; the
    // event ID makes Inngest execute it once.
    if (run.status === "running") {
      await sendRunRequested({ orgId: ctx.orgId, runId: run.id, connectionId: connection.id });
    }
    runIds.push(run.id);
  }
  return { runIds };
}

type RecordedRun = { id: string; status: (typeof runs.$inferSelect)["status"] };

// The run for (switch, message): the one recorded already, or a new one. Null when the
// connection or enablement went meanwhile.
async function recordRun(
  ctx: Ctx,
  connection: ConnectionDetails,
  on: SwitchedOn,
  sourceRef: string,
): Promise<RecordedRun | null> {
  const by = on.switch;
  const triggerKey =
    by.kind === "org"
      ? `workflow:${by.workflowId}:${sourceRef}`
      : `enablement:${by.enablementId}:${sourceRef}`;
  const db = forOrg(ctx);
  try {
    const created = await db.insert(
      runs,
      {
        id: randomUUID(),
        connectionId: connection.id,
        ownerScope: connection.kind,
        workflowId: on.workflowId,
        workflowVersionId: on.versionId,
        startedBy: by.kind === "org" ? "org_switch" : "enablement",
        enablementId: by.kind === "member" ? by.enablementId : null,
        sourceRef,
        triggerKey,
        status: "running",
      },
      { onConflictDoNothing: true },
    );
    const run =
      created.at(0) ??
      (await db.select(runs, { where: eq(runs.triggerKey, triggerKey), limit: 1 })).at(0);
    return run === undefined ? null : { id: run.id, status: run.status };
  } catch (error) {
    if (GONE_FOREIGN_KEYS.some((name) => isForeignKeyViolation(error, name))) return null;
    throw error;
  }
}

async function connectionOrNull(ctx: Ctx, connectionId: string): Promise<ConnectionDetails | null> {
  try {
    return await getConnection(ctx, connectionId);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}
