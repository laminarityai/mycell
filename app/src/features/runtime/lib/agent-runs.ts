// Runs started from Ask Mycel (M9): a person runs one of their own switched-on workflows on a
// message in their own mail, which the trigger missed or came before they switched it on. It
// runs the latest version on their own inbox under their enablement, refused in words whenever
// the trigger's fan-out wouldn't start it (`workflows`' startableEnablement: visibility, the
// switch, every pause, out of credits included). Its writes wait on the Reviews page like any
// run's. One agent run of a workflow on a message runs at a time (runs_agent_running_unique).
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { isForeignKeyViolation, isUniqueViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { GMAIL, messageSchema } from "@/features/connections/gmail";
import { getConnection, proxyGet } from "@/features/connections/server";
import { SourceRequestError } from "@/features/connections/types";
import { saveWithEvents } from "@/features/outbox/server";
import { startableEnablement } from "@/features/workflows/server";
import type { StartableEnablement } from "@/features/workflows/types";
import type { Ctx } from "@/lib/ctx";
import { ConflictError, ValidationError } from "@/lib/errors";
import type { AgentRunStart } from "../types";
import { requestRun } from "./request-run";
import { runs } from "./schema";

const NOT_IN_MAIL = "That message isn't in your mail.";

const refSchema = messageSchema.pick({ id: true });

/**
 * What a run from Ask Mycel of `workflowId` on the message `sourceRef` would be, if it may start
 * now, without starting it: the workflow, and the person's own inbox it runs on. Refused with
 * the reason in words, as `startRunFromAgent` would refuse it.
 */
export async function checkRunFromAgent(
  ctx: Ctx,
  workflowId: string,
  sourceRef: string,
): Promise<AgentRunStart> {
  const { start } = await startable(ctx, workflowId, sourceRef);
  return start;
}

/**
 * Starts a run of the workflow's latest version on the message, on the person's own inbox under
 * their enablement, `started_by = agent`, and asks for it to execute. Everything is checked
 * again (`checkRunFromAgent`), and a second run of the workflow on the message is refused while
 * one is running, however close together they're asked for.
 */
export async function startRunFromAgent(
  ctx: Ctx,
  workflowId: string,
  sourceRef: string,
): Promise<{ runId: string }> {
  const { start, own } = await startable(ctx, workflowId, sourceRef);
  const runId = randomUUID();
  try {
    // The run and its request are saved together (ADR-0027).
    await saveWithEvents(ctx, async (tx, emit) => {
      await tx.insert(runs, {
        id: runId,
        connectionId: own.connectionId,
        ownerScope: "member",
        workflowId: own.workflowId,
        workflowVersionId: own.versionId,
        startedBy: "agent",
        enablementId: own.enablementId,
        sourceRef: start.sourceRef,
        status: "running",
      });
      requestRun(ctx, emit, { id: runId, connectionId: own.connectionId });
    });
  } catch (error) {
    if (isUniqueViolation(error, "runs_agent_running_unique")) throw alreadyRunning(own.name);
    // Switched off, or the inbox disconnected, since the check.
    if (isForeignKeyViolation(error, "runs_enablement_fk")) throw notOn(own.name);
    throw error;
  }
  return { runId };
}

async function startable(
  ctx: Ctx,
  workflowId: string,
  sourceRef: string,
): Promise<{ start: AgentRunStart; own: StartableEnablement }> {
  const messageId = sourceRef.trim();
  if (messageId === "") throw new ValidationError("Name a message from your mail.");
  const own = await startableEnablement(ctx, workflowId);
  const connection = await getConnection(ctx, own.connectionId);
  if (connection.needsReauth) {
    throw new ConflictError("Google refused access to your inbox. Reconnect Google first.");
  }
  if (!(await inMailbox(ctx, connection.id, messageId))) throw new ValidationError(NOT_IN_MAIL);
  // Any run of it on the message under way, however it started, would draft the same reply.
  const running = await forOrg(ctx).select(runs, {
    columns: ["id"],
    where: and(
      eq(runs.workflowId, own.workflowId),
      eq(runs.connectionId, connection.id),
      eq(runs.sourceRef, messageId),
      eq(runs.status, "running"),
    ),
    limit: 1,
  });
  if (running.length > 0) throw alreadyRunning(own.name);
  return {
    start: {
      workflowId: own.workflowId,
      workflowName: own.name,
      connectionId: connection.id,
      sourceRef: messageId,
    },
    own,
  };
}

// Whether Gmail has the message in the inbox's mailbox. Gmail answers an ID that isn't one with
// 400, and a message it doesn't have with 404.
async function inMailbox(ctx: Ctx, connectionId: string, messageId: string): Promise<boolean> {
  const path = `${GMAIL}/messages/${encodeURIComponent(messageId)}?format=minimal`;
  try {
    return (await proxyGet(ctx, connectionId, path, refSchema)) !== null;
  } catch (error) {
    if (error instanceof SourceRequestError && error.status === 400) return false;
    throw error;
  }
}

const alreadyRunning = (name: string) =>
  new ConflictError(`${name} is already running on that message.`);

const notOn = (name: string) =>
  new ConflictError(`You haven't switched ${name} on. Switch it on from Workflows first.`);
