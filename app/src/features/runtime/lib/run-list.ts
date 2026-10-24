// The Runs page's list: runs across every workflow, newest first, filtered and keyset-paged. An
// admin sees every run in the org and a member the runs on their own member connection. A run
// is shown in full only to its connection's readers; anyone else gets it redacted (no source
// ref, no subject or sender, nothing a step handed on), with its status, failed steps, cost and
// times (ADR-0001). The same queries however many runs a page holds.
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { env } from "@/env";
import { connectionOwners } from "@/features/connections/server";
import type { ConnectionOwnership } from "@/features/connections/types";
import { describePathTo } from "@/features/spec/describe";
import { versionsById, workflowNames } from "@/features/workflows/server";
import type { WorkflowVersion } from "@/features/workflows/types";
import { isAdmin, requireRole, type Ctx } from "@/lib/ctx";
import type {
  RunFailure,
  RunFilters,
  RunInbox,
  RunListItem,
  RunPage,
  RunPageRequest,
} from "../types";
import { messagesOf } from "./run-messages";
import { runs, runSteps } from "./schema";

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const RUN_COLUMNS = [
  "id",
  "workflowId",
  "workflowVersionId",
  "connectionId",
  "ownerScope",
  "startedBy",
  "sourceRef",
  "status",
  "errorCode",
  "costUsd",
  "startedAt",
  "finishedAt",
] as const;

type Row = Pick<typeof runs.$inferSelect, (typeof RUN_COLUMNS)[number]>;

/** The runs the caller may see that pass `filters`, one page of them, newest first. */
export async function listRuns(
  ctx: Ctx,
  filters: RunFilters,
  page: RunPageRequest = {},
): Promise<RunPage> {
  const { owners, visible } = await visibleRuns(ctx);
  if (visible === null) return { runs: [], newer: null, older: null };
  const where = and(
    visible,
    filters.workflowId === undefined ? undefined : eq(runs.workflowId, filters.workflowId),
    filters.status === undefined ? undefined : eq(runs.status, filters.status),
    filters.connectionId === undefined ? undefined : eq(runs.connectionId, filters.connectionId),
  );
  const size = Math.min(Math.max(Math.trunc(page.size ?? PAGE_SIZE), 1), MAX_PAGE_SIZE);
  let found = await pageOf(ctx, where, page, size);
  // The run a cursor names is gone (its connection was deleted): start from the newest.
  if (found.rows.length === 0 && (page.olderThan ?? page.newerThan) !== undefined) {
    found = await pageOf(ctx, where, {}, size);
  }
  // Only what the page names: the rows themselves hold what a redacted run mustn't give.
  return { runs: await items(ctx, found.rows, owners), newer: found.newer, older: found.older };
}

/**
 * Whose each connection is, and which runs the caller may see: every run in the org for an
 * admin (`visible` undefined), those on their own member connections for a member, or none
 * (`visible` null).
 */
export async function visibleRuns(ctx: Ctx): Promise<{
  owners: Map<string, ConnectionOwnership>;
  visible: SQL | undefined | null;
}> {
  requireRole(ctx, "admin", "member");
  const owners = new Map((await connectionOwners(ctx)).map((owner) => [owner.id, owner]));
  if (isAdmin(ctx)) return { owners, visible: undefined };
  const own = [...owners.values()].filter((owner) => owner.kind === "member" && owner.readable);
  return {
    owners,
    visible:
      own.length === 0
        ? null
        : inArray(
            runs.connectionId,
            own.map((owner) => owner.id),
          ),
  };
}

type Found = { rows: Row[]; newer: string | null; older: string | null };

// One page by keyset on (started_at, id), newest first, and the cursors either side of it.
async function pageOf(
  ctx: Ctx,
  where: SQL | undefined,
  page: RunPageRequest,
  size: number,
): Promise<Found> {
  const select = (keyset: SQL | undefined, newestFirst: boolean) =>
    forOrg(ctx).select(runs, {
      columns: RUN_COLUMNS,
      where: and(where, keyset),
      orderBy: newestFirst
        ? [desc(runs.startedAt), desc(runs.id)]
        : [asc(runs.startedAt), asc(runs.id)],
      limit: size + 1,
    });
  if (page.newerThan !== undefined) {
    const rows = await select(
      sql`(${runs.startedAt}, ${runs.id}) > ${at(ctx, page.newerThan)}`,
      false,
    );
    const shown = rows.slice(0, size).reverse();
    return {
      rows: shown,
      newer: rows.length > size ? (shown.at(0)?.id ?? null) : null,
      older: shown.at(-1)?.id ?? null,
    };
  }
  const rows = await select(
    page.olderThan === undefined
      ? undefined
      : sql`(${runs.startedAt}, ${runs.id}) < ${at(ctx, page.olderThan)}`,
    true,
  );
  const shown = rows.slice(0, size);
  return {
    rows: shown,
    newer: page.olderThan === undefined ? null : (shown.at(0)?.id ?? null),
    older: rows.length > size ? (shown.at(-1)?.id ?? null) : null,
  };
}

// Where a run sits in the keyset, read in the same query, so its start time keeps Postgres's
// microseconds (a Date would round them off and repeat or skip a run at the page's edge).
function at(ctx: Ctx, runId: string): SQL {
  return sql`(select edge.started_at, edge.id from runs as edge where edge.org_id = ${ctx.orgId} and edge.id = ${runId})`;
}

async function items(
  ctx: Ctx,
  rows: Row[],
  owners: Map<string, ConnectionOwnership>,
): Promise<RunListItem[]> {
  if (rows.length === 0) return [];
  const full = rows.filter((row) => owners.get(row.connectionId)?.readable === true);
  const [versions, names] = await Promise.all([
    versionsById(
      ctx,
      rows.map((row) => row.workflowVersionId),
    ),
    workflowNames(
      ctx,
      rows.map((row) => row.workflowId),
    ),
  ]);
  // What started each run, from the version it ran: a Gmail message or a calendar invite.
  const trigger = (row: Row) =>
    versions.get(row.workflowVersionId)?.spec.trigger.type ?? "gmail.message_received";
  const [failures, messages] = await Promise.all([
    failuresOf(ctx, rows, versions),
    messagesOf(
      ctx,
      full.map((row) => ({ ...row, trigger: trigger(row) })),
    ),
  ]);
  return rows.map((row) => ({
    id: row.id,
    workflowId: row.workflowId,
    workflowName: names.get(row.workflowId) ?? "Deleted workflow",
    connectionId: row.connectionId,
    ownerScope: row.ownerScope,
    startedBy: row.startedBy,
    inbox: inboxOf(owners.get(row.connectionId)),
    message: messages.get(row.id) ?? null,
    status: row.status,
    errorCode: row.errorCode,
    costUsd: row.costUsd,
    costCredits: row.costUsd * env.CREDITS_PER_USD,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    failures: failures.get(row.id) ?? [],
  }));
}

/** Whose inbox a connection is, as the caller may know it. */
export function inboxOf(owner: ConnectionOwnership | undefined): RunInbox {
  if (owner === undefined) return { kind: "colleague", ownerName: "someone no longer in the org" };
  if (owner.accountEmail !== null) {
    return { kind: owner.kind === "org" ? "org" : "yours", accountEmail: owner.accountEmail };
  }
  return {
    kind: "colleague",
    ownerName: owner.owner.removed ? "someone no longer in the org" : owner.owner.name,
  };
}

// Each run's failed steps, in spec order, each with the path it's on.
async function failuresOf(
  ctx: Ctx,
  rows: Row[],
  versions: Map<string, WorkflowVersion>,
): Promise<Map<string, RunFailure[]>> {
  const failed = await forOrg(ctx).select(runSteps, {
    columns: ["runId", "stepId", "status", "errorCode", "errorMessage"],
    where: and(
      inArray(
        runSteps.runId,
        rows.map((row) => row.id),
      ),
      inArray(runSteps.status, ["failed", "check_failed"]),
    ),
    orderBy: [runSteps.position],
  });
  if (failed.length === 0) return new Map();
  const versionOf = new Map(rows.map((row) => [row.id, row.workflowVersionId]));
  const byRun = new Map<string, RunFailure[]>();
  for (const step of failed) {
    if (step.status !== "failed" && step.status !== "check_failed") continue;
    const spec = versions.get(versionOf.get(step.runId) ?? "")?.spec;
    byRun.set(step.runId, [
      ...(byRun.get(step.runId) ?? []),
      {
        stepId: step.stepId,
        path: spec === undefined ? null : describePathTo(spec, step.stepId),
        status: step.status,
        errorCode: step.errorCode,
        errorMessage: step.errorMessage,
      },
    ]);
  }
  return byRun;
}
