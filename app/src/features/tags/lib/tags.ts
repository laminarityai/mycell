import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { isUniqueViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { saveWithEvents } from "@/features/outbox/server";
import { type Ctx, requireAdmin, requireRole } from "@/lib/ctx";
import { ConflictError, InvariantError, NotFoundError, ValidationError } from "@/lib/errors";
import { tagDeleted, tagRenamed } from "../events";
import type { Tag, TagSummary } from "../types";
import { tagAssignments, tags } from "./schema";
import { normalizeTagName } from "./tag-name";

export async function createTag(ctx: Ctx, name: string): Promise<TagSummary> {
  requireAdmin(ctx);
  const normalized = normalizeTagName(name);
  const inserted = await forOrg(ctx)
    .insert(tags, { id: randomUUID(), name: normalized })
    .catch(rethrowDuplicate(normalized));
  const tag = inserted.at(0);
  if (tag === undefined) throw new InvariantError("Insert returned no tag");
  return { id: tag.id, name: tag.name, userIds: [] };
}

/**
 * Renames the tag. Who it reaches stays the same (versions hold its ID); announced
 * (`tags/tag.renamed`, through the outbox) when the name changed, so working specs naming it
 * follow it. The event's ID names the revision the rename made.
 */
export async function renameTag(ctx: Ctx, tagId: string, name: string): Promise<void> {
  requireAdmin(ctx);
  const normalized = normalizeTagName(name);
  const before = (
    await forOrg(ctx).select(tags, { columns: ["name"], where: eq(tags.id, tagId), limit: 1 })
  ).at(0);
  if (before === undefined) throw new NotFoundError("tag");
  if (before.name === normalized) return;
  await saveWithEvents(ctx, async (tx, emit) => {
    const updated = await tx
      .update(tags, { name: normalized, revision: sql`${tags.revision} + 1` }, eq(tags.id, tagId))
      .catch(rethrowDuplicate(normalized));
    const tag = updated.at(0);
    if (tag === undefined) throw new NotFoundError("tag");
    emit(
      tagRenamed,
      { orgId: ctx.orgId, tagId, from: before.name, to: normalized },
      `tag-renamed-${tagId}-${String(tag.revision)}`,
    );
  });
}

export async function listTags(ctx: Ctx): Promise<TagSummary[]> {
  requireAdmin(ctx);
  const db = forOrg(ctx);
  const rows = await db.select(tags, { orderBy: [asc(tags.name)] });
  const assignments = await db.select(tagAssignments, { orderBy: [asc(tagAssignments.userId)] });
  return rows.map((tag) => ({
    id: tag.id,
    name: tag.name,
    userIds: assignments.filter((a) => a.tagId === tag.id).map((a) => a.userId),
  }));
}

/**
 * Deletes the tag; its assignments, and the workflow versions' publishing to it, go with it
 * (foreign key cascades). Announced (`tags/tag.deleted`, through the outbox), so workflows its
 * users no longer see stop being switched on for them.
 */
export async function deleteTag(ctx: Ctx, tagId: string): Promise<void> {
  requireAdmin(ctx);
  await saveWithEvents(ctx, async (tx, emit) => {
    const deleted = await tx.deleteCount(tags, eq(tags.id, tagId));
    if (deleted === 0) throw new NotFoundError("tag");
    emit(tagDeleted, { orgId: ctx.orgId, tagId }, `tag-deleted-${tagId}`);
  });
}

/** The caller's own tags. Any role may ask: it's how a member sees which tags they have. */
export async function listMyTags(ctx: Ctx): Promise<Tag[]> {
  const db = forOrg(ctx);
  const mine = await db.select(tagAssignments, { where: eq(tagAssignments.userId, ctx.userId) });
  if (mine.length === 0) return [];
  const rows = await db.select(tags, {
    where: inArray(
      tags.id,
      mine.map((a) => a.tagId),
    ),
    orderBy: [asc(tags.name)],
  });
  return rows.map((tag) => ({ id: tag.id, name: tag.name }));
}

/**
 * The current names of the tags with these IDs in the caller's org, by ID; a tag that's gone (or
 * another org's) has none. Admins and the system ctx may ask.
 */
export async function tagNamesById(
  ctx: Ctx,
  tagIds: readonly string[],
): Promise<Map<string, string>> {
  requireRole(ctx, "admin", "system");
  if (tagIds.length === 0) return new Map();
  const rows = await forOrg(ctx).select(tags, { where: inArray(tags.id, [...new Set(tagIds)]) });
  return new Map(rows.map((tag) => [tag.id, tag.name]));
}

/**
 * The caller's org's tags with these names, each once, in the order given: what publishing a
 * spec stores for its `visibility.tags`. A name no tag has is refused with ValidationError
 * naming it, so a typo can't hide a workflow from everyone. Admins (who publish) and the system
 * ctx may ask.
 */
export async function findTagsByName(ctx: Ctx, names: readonly string[]): Promise<Tag[]> {
  requireRole(ctx, "admin", "system");
  const wanted = [...new Set(names)];
  if (wanted.length === 0) return [];
  const rows = await forOrg(ctx).select(tags, { where: inArray(tags.name, wanted) });
  const byName = new Map(rows.map((tag) => [tag.name, { id: tag.id, name: tag.name }]));
  const unknown = wanted.filter((name) => !byName.has(name));
  if (unknown.length > 0) {
    const list = unknown.map((name) => `"${name}"`).join(", ");
    throw new ValidationError(
      `There's no tag called ${list} in your org. Create it on the tags screen, or publish to another tag.`,
    );
  }
  return wanted.flatMap((name) => byName.get(name) ?? []);
}

function rethrowDuplicate(name: string) {
  return (error: unknown): never => {
    if (isUniqueViolation(error, "tags_org_id_name_unique")) {
      throw new ConflictError(`There's already a tag called "${name}".`);
    }
    throw error;
  };
}
