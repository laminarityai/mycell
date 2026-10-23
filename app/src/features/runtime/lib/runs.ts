// Run records: starting a run by hand, and reading runs back. Reads and the manual start are
// admin-only in M3; the interpreter writes as the system ctx (interpreter.ts). A run is read
// only by whoever may read its connection (connections' rule): a run on a member connection
// holds what that member's mail made, so it stays with them (invariant 2, ADR-0001).
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { getConnection, readableConnectionIds } from "@/features/connections/server";
import { describePathTo } from "@/features/spec/describe";
import type { Spec } from "@/features/spec/types";
import { getWorkflow, getWorkflowVersion } from "@/features/workflows/server";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { RunRecord, RunStepRecord } from "../types";
import { sendRunRequested } from "./events";
import { runs, runSteps } from "./schema";

type Run = typeof runs.$inferSelect;
type RunStepRow = typeof runSteps.$inferSelect;

/** How many runs a workflow's page lists. */
const RECENT_RUNS = 20;

/**
 * Runs the workflow's latest version on one message of a connection, as a debugging aid: the
 * manual twin of the trigger. The connection must suit the spec's credentials (the admin's own
 * member connection, or an org connection) and be the admin's to read.
 */
export async function startRun(
  ctx: Ctx,
  workflowId: string,
  connectionId: string,
  sourceRef: string,
): Promise<{ runId: string }> {
  requireAdmin(ctx);
  const messageId = sourceRef.trim();
  if (messageId === "") throw new ValidationError("Give the ID of a Gmail message.");
  const workflow = await getWorkflow(ctx, workflowId);
  const latest = workflow.versions.at(0);
  if (latest === undefined) throw new ValidationError("Publish the workflow before running it.");
  const version = await getWorkflowVersion(ctx, latest.id);
  const connection = await getConnection(ctx, connectionId);
  if (connection.kind !== version.spec.credentials) {
    throw new ValidationError(
      version.spec.credentials === "member"
        ? "This workflow runs on your own connection, not an org connection."
        : "This workflow runs on an org connection.",
    );
  }
  const runId = randomUUID();
  await forOrg(ctx).insert(runs, {
    id: runId,
    connectionId,
    ownerScope: connection.kind,
    workflowId,
    workflowVersionId: version.id,
    sourceRef: messageId,
    status: "running",
  });
  await sendRunRequested({ orgId: ctx.orgId, runId, connectionId });
  return { runId };
}

/** One run with its steps, on a connection the caller may read. */
export async function getRun(ctx: Ctx, runId: string): Promise<RunRecord> {
  requireAdmin(ctx);
  const run = await findRun(ctx, runId);
  if (run === undefined) throw new NotFoundError("run");
  const readable = await readableConnectionIds(ctx);
  if (!readable.includes(run.connectionId)) throw new ForbiddenError();
  const record = (await withSteps(ctx, [run])).at(0);
  if (record === undefined) throw new NotFoundError("run");
  return record;
}

/**
 * The workflow's most recent runs on connections the caller may read, newest first, each with
 * its steps.
 */
export async function listRuns(ctx: Ctx, workflowId: string): Promise<RunRecord[]> {
  requireAdmin(ctx);
  const readable = await readableConnectionIds(ctx);
  if (readable.length === 0) return [];
  const rows = await forOrg(ctx).select(runs, {
    where: and(eq(runs.workflowId, workflowId), inArray(runs.connectionId, readable)),
    orderBy: [desc(runs.startedAt)],
    limit: RECENT_RUNS,
  });
  return withSteps(ctx, rows);
}

export async function findRun(ctx: Ctx, runId: string): Promise<Run | undefined> {
  return (await forOrg(ctx).select(runs, { where: eq(runs.id, runId), limit: 1 })).at(0);
}

/** The run's recorded steps, in spec order. */
export async function stepsOf(ctx: Ctx, runIds: string[]): Promise<RunStepRow[]> {
  if (runIds.length === 0) return [];
  return forOrg(ctx).select(runSteps, {
    where: inArray(runSteps.runId, runIds),
    orderBy: [runSteps.position],
  });
}

async function withSteps(ctx: Ctx, rows: Run[]): Promise<RunRecord[]> {
  const steps = await stepsOf(
    ctx,
    rows.map((row) => row.id),
  );
  // Each version's spec, which names the path each step is on.
  const versionIds = [...new Set(rows.map((row) => row.workflowVersionId))];
  const specs = new Map(
    await Promise.all(
      versionIds.map(async (id) => [id, (await getWorkflowVersion(ctx, id)).spec] as const),
    ),
  );
  return rows.map((row) => ({
    id: row.id,
    workflowId: row.workflowId,
    workflowVersionId: row.workflowVersionId,
    connectionId: row.connectionId,
    ownerScope: row.ownerScope,
    enablementId: row.enablementId,
    sourceRef: row.sourceRef,
    status: row.status,
    errorCode: row.errorCode,
    costUsd: row.costUsd,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    steps: steps
      .filter((step) => step.runId === row.id)
      .map((step) => stepRecord(step, specs.get(row.workflowVersionId))),
  }));
}

function stepRecord(row: RunStepRow, spec: Spec | undefined): RunStepRecord {
  return {
    stepId: row.stepId,
    type: row.type,
    path: spec === undefined ? null : describePathTo(spec, row.stepId),
    status: row.status,
    attempts: row.attempts,
    lastAttemptAt: row.lastAttemptAt,
    output: row.output ?? null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    modelRole: row.modelRole,
    modelId: row.modelId,
    costUsd: row.costUsd,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}
