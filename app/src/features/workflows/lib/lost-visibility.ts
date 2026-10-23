// Losing sight of a workflow (M5): tags decide who runs what, so an enablement whose user can no
// longer see its workflow's latest version is deleted, not paused (they couldn't see it to
// resume it). Publishing to fewer tags cleans up in its own transaction; losing or deleting a
// tag cleans up in a job, as the system ctx (ADR-0009). Until a job runs, the trigger's fan-out
// checks visibility itself (startable.ts), so a slow cleanup never starts a run.
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { type Ctx, requireRole } from "@/lib/ctx";
import { latestVersions } from "./latest-versions";
import { enablements } from "./schema";
import { seenByUsers, type InTransaction } from "./visibility";

/** Whose enablements to look at: one user's, one workflow's, both, or (neither) the org's. */
export type LostVisibilityScope = { userId?: string; workflowId?: string };

/**
 * Deletes the enablements in `scope` whose user can no longer see the workflow (archiving
 * isn't losing sight: an archived workflow's enablements stay). Returns how many went. Admins
 * and the system ctx may ask.
 */
export async function removeInvisibleEnablements(
  ctx: Ctx,
  scope: LostVisibilityScope,
): Promise<number> {
  requireRole(ctx, "admin", "system");
  return removeInvisible(ctx, scope);
}

/**
 * removeInvisibleEnablements inside a transaction: a publish passes its `tx` and the viewers it
 * read before it began (readViewers), so this queries only through `tx`.
 */
export async function removeInvisibleIn(
  ctx: Ctx,
  inTransaction: InTransaction,
  scope: LostVisibilityScope,
): Promise<number> {
  return removeInvisible(ctx, scope, inTransaction);
}

async function removeInvisible(
  ctx: Ctx,
  scope: LostVisibilityScope,
  inTransaction?: InTransaction,
): Promise<number> {
  const db = inTransaction?.tx ?? forOrg(ctx);
  const rows = await db.select(enablements, { where: inScope(scope) });
  if (rows.length === 0) return 0;
  const latest = await latestVersions(ctx, [...new Set(rows.map((row) => row.workflowId))], db);
  const pairs = rows.flatMap((row) => {
    const version = latest.get(row.workflowId);
    return version === undefined ? [] : [{ row, versionId: version.id }];
  });
  const seen = await seenByUsers(
    ctx,
    pairs.map(({ row, versionId }) => ({ userId: row.userId, versionId })),
    inTransaction,
  );
  const unseen = pairs
    .filter(({ row, versionId }) => !seen(row.userId, versionId))
    .map(({ row }) => row.id);
  if (unseen.length === 0) return 0;
  return (await db.delete(enablements, inArray(enablements.id, unseen))).length;
}

function inScope({ userId, workflowId }: LostVisibilityScope): SQL | undefined {
  return and(
    userId === undefined ? undefined : eq(enablements.userId, userId),
    workflowId === undefined ? undefined : eq(enablements.workflowId, workflowId),
  );
}
