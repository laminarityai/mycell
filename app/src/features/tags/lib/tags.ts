import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { isUniqueViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
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
  if (tag === undefined) throw new Error("Insert returned no tag");
  return { id: tag.id, name: tag.name, userIds: [] };
}

export async function renameTag(ctx: Ctx, tagId: string, name: string): Promise<void> {
  requireAdmin(ctx);
  const normalized = normalizeTagName(name);
  const updated = await forOrg(ctx)
    .update(tags, { name: normalized }, eq(tags.id, tagId))
    .catch(rethrowDuplicate(normalized));
  if (updated.length === 0) throw new NotFoundError("tag");
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

/** Deletes the tag; its assignments go with it (foreign key cascade). */
export async function deleteTag(ctx: Ctx, tagId: string): Promise<void> {
  requireAdmin(ctx);
  const deleted = await forOrg(ctx).delete(tags, eq(tags.id, tagId));
  if (deleted.length === 0) throw new NotFoundError("tag");
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
 * The caller's org's tags with these names, each once, in the order given: what publishing a
 * spec stores for its `visibility.tags`. A name no tag has is refused with ValidationError
 * naming it, so a typo can't hide a workflow from everyone. Admins (who publish) and the system
 * ctx may ask.
 */
export async function findTagsByName(ctx: Ctx, names: readonly string[]): Promise<Tag[]> {
  if (ctx.role !== "admin" && ctx.role !== "system") throw new ForbiddenError();
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
