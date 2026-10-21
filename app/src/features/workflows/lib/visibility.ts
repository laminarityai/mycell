// Who sees a workflow (M5): a member sees one whose latest published version shares a tag with
// them, unless it's archived; an admin sees every one. What the Workflows page shows is read here.
import { eq, inArray } from "drizzle-orm";
import { forOrg, type OrgScopedDb } from "@/db/for-org";
import { findAction } from "@/features/policy/catalog";
import type { RiskLevel } from "@/features/policy/types";
import { describeSpec, type ActionInfo } from "@/features/spec/describe";
import { listUsers } from "@/features/orgs/server";
import { listMyTags, listTagIdsByUser, listTags } from "@/features/tags/server";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import type { Audience, VisibleWorkflow, WorkflowVersion } from "../types";
import { requiredApps } from "./requirements";
import { workflows, workflowVersionTags } from "./schema";
import { switchesOf } from "./switches";
import { latestVersions } from "./latest-versions";

type Workflow = typeof workflows.$inferSelect;

/** The published workflows the caller can see, by name. */
export async function listVisibleWorkflows(ctx: Ctx): Promise<VisibleWorkflow[]> {
  const rows = await forOrg(ctx).select(workflows, { orderBy: [workflows.name] });
  return visible(ctx, rows);
}

/** One published workflow the caller can see; NotFoundError for any other, in any org. */
export async function getVisibleWorkflow(ctx: Ctx, workflowId: string): Promise<VisibleWorkflow> {
  const rows = await forOrg(ctx).select(workflows, {
    where: eq(workflows.id, workflowId),
    limit: 1,
  });
  const found = (await visible(ctx, rows)).at(0);
  if (found === undefined) throw new NotFoundError("workflow");
  return found;
}

/** Each published version's audience, by version ID: an admin's view of who it reaches. */
export async function audiencesOf(ctx: Ctx, versionIds: string[]): Promise<Map<string, Audience>> {
  const tagIds = await tagIdsOf(ctx, versionIds);
  const tags = new Map((await listTags(ctx)).map((tag) => [tag.id, tag]));
  return new Map(
    versionIds.map((versionId) => {
      const published = (tagIds.get(versionId) ?? []).flatMap((id) => tags.get(id) ?? []);
      const reached = new Set(published.flatMap((tag) => tag.userIds));
      return [
        versionId,
        {
          tags: published
            .map(({ id, name }) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          reach: reached.size,
        },
      ];
    }),
  );
}

/**
 * Whether a user can see a workflow version, for each of `pairs` asked: an admin sees every
 * one; anyone else one published to a tag they have; someone no longer in the org, none. It's
 * how the system ctx checks what someone else may see (the trigger's fan-out, say), so it
 * reads their tags rather than the caller's. Asking about a pair not given answers false.
 * Versions' tags are read through `db`, which a publish passes to see the version it's writing.
 */
export async function seenByUsers(
  ctx: Ctx,
  pairs: readonly { userId: string; versionId: string }[],
  db: OrgScopedDb = forOrg(ctx),
): Promise<(userId: string, versionId: string) => boolean> {
  if (pairs.length === 0) return () => false;
  const asked = new Set(pairs.map(({ userId, versionId }) => `${userId}\n${versionId}`));
  const roles = new Map((await listUsers(ctx)).map((user) => [user.id, user.role]));
  const userTags = await listTagIdsByUser(ctx, [...new Set(pairs.map(({ userId }) => userId))]);
  const versionTags = await tagIdsOf(
    ctx,
    [...new Set(pairs.map(({ versionId }) => versionId))],
    db,
  );
  return (userId, versionId) => {
    if (!asked.has(`${userId}\n${versionId}`)) return false;
    const role = roles.get(userId);
    if (role === undefined) return false;
    if (role === "admin") return true;
    const theirs = new Set(userTags.get(userId) ?? []);
    return (versionTags.get(versionId) ?? []).some((tagId) => theirs.has(tagId));
  };
}

async function visible(ctx: Ctx, rows: Workflow[]): Promise<VisibleWorkflow[]> {
  const latest = await latestVersions(
    ctx,
    rows.map((row) => row.id),
  );
  const admin = ctx.role === "admin";
  const published = rows.flatMap((row) => {
    const version = latest.get(row.id);
    // An archived workflow is hidden from everyone but admins.
    if (version === undefined || (row.archivedAt !== null && !admin)) return [];
    return [{ row, version }];
  });
  const versionIds = published.map(({ version }) => version.id);
  const seen = admin ? published : await sharingATag(ctx, published, versionIds);
  const switches = await switchesOf(
    ctx,
    seen.map(({ row }) => row),
  );
  // Members don't learn who else a workflow reaches.
  const audiences = admin ? await audiencesOf(ctx, versionIds) : new Map<string, Audience>();
  return seen.map(({ row, version }) => ({
    id: row.id,
    name: row.name,
    description: describe(version),
    requiredApps: requiredApps(version),
    maxRisk: version.maxRisk,
    credentials: version.spec.credentials,
    versionNumber: version.number,
    switch: switches.get(row.id) ?? null,
    audience: audiences.get(version.id) ?? null,
  }));
}

/** The workflows whose latest version has one of the caller's tags. */
export async function sharingATag<T extends { version: WorkflowVersion }>(
  ctx: Ctx,
  published: T[],
  versionIds: string[],
): Promise<T[]> {
  const mine = new Set((await listMyTags(ctx)).map((tag) => tag.id));
  if (mine.size === 0) return [];
  const tagIds = await tagIdsOf(ctx, versionIds);
  return published.filter(({ version }) =>
    (tagIds.get(version.id) ?? []).some((tagId) => mine.has(tagId)),
  );
}

// Each version's tag IDs, by version ID.
async function tagIdsOf(
  ctx: Ctx,
  versionIds: string[],
  db: OrgScopedDb = forOrg(ctx),
): Promise<Map<string, string[]>> {
  const byVersion = new Map<string, string[]>();
  if (versionIds.length === 0) return byVersion;
  const rows = await db.select(workflowVersionTags, {
    where: inArray(workflowVersionTags.workflowVersionId, versionIds),
  });
  for (const row of rows) {
    byVersion.set(row.workflowVersionId, [
      ...(byVersion.get(row.workflowVersionId) ?? []),
      row.tagId,
    ]);
  }
  return byVersion;
}

// What the version does, a sentence per step.
function describe(version: WorkflowVersion): string[] {
  return describeSpec(version.spec, { action: actionInfo }).map((step) => step.text);
}

function actionInfo(name: string): ActionInfo<RiskLevel> | undefined {
  const action = findAction(name);
  if (action === undefined) return undefined;
  const { risk, description, conditionFields } = action;
  return { risk, description, conditionFields };
}
