import { and, eq, inArray } from "drizzle-orm";
import { isUniqueViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { listUsers } from "@/features/orgs/server";
import { saveWithEvents } from "@/features/outbox/server";
import { type Ctx, requireAdmin, requireRole } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { tagAssignmentRemoved } from "../events";
import { requireTag } from "./access";
import { tagAssignments } from "./schema";

/** Gives the user the tag; does nothing if they already have it. */
export async function assignTag(ctx: Ctx, tagId: string, userId: string): Promise<void> {
  requireAdmin(ctx);
  await requireTag(ctx, tagId);
  // The member foreign key also enforces this; checking first gives the caller a clear error.
  if (!(await listUsers(ctx)).some((user) => user.id === userId)) {
    throw new NotFoundError("user");
  }
  await forOrg(ctx)
    .insert(tagAssignments, { tagId, userId })
    .catch((error: unknown) => {
      if (isUniqueViolation(error, "tag_assignments_tag_id_user_id_pk")) return [];
      throw error;
    });
}

/**
 * The IDs of the tags each of `userIds` has, by user ID (a user with none is left out): how
 * the system ctx checks which workflows someone else can see. Admins and the system ctx may ask.
 */
export async function listTagIdsByUser(
  ctx: Ctx,
  userIds: readonly string[],
): Promise<Map<string, string[]>> {
  requireRole(ctx, "admin", "system");
  const byUser = new Map<string, string[]>();
  if (userIds.length === 0) return byUser;
  const rows = await forOrg(ctx).select(tagAssignments, {
    where: inArray(tagAssignments.userId, [...userIds]),
  });
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.tagId]);
  return byUser;
}

/**
 * Takes the tag from the user, and announces it when they had it (`tags/assignment.removed`,
 * through the outbox), so workflows they no longer see stop being switched on for them. The
 * event's ID names the assignment, by when it was made.
 */
export async function unassignTag(ctx: Ctx, tagId: string, userId: string): Promise<void> {
  requireAdmin(ctx);
  await requireTag(ctx, tagId);
  await saveWithEvents(ctx, async (tx, emit) => {
    const removed = await tx.delete(
      tagAssignments,
      and(eq(tagAssignments.tagId, tagId), eq(tagAssignments.userId, userId)),
    );
    for (const assignment of removed) {
      emit(
        tagAssignmentRemoved,
        { orgId: ctx.orgId, tagId, userId },
        `tag-unassigned-${tagId}-${userId}-${String(assignment.createdAt.getTime())}`,
      );
    }
  });
}
