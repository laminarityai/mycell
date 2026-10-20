import { and, eq } from "drizzle-orm";
import { isUniqueViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { listUsers } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { requireAdmin, requireTag } from "./access";
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

export async function unassignTag(ctx: Ctx, tagId: string, userId: string): Promise<void> {
  requireAdmin(ctx);
  await requireTag(ctx, tagId);
  await forOrg(ctx).delete(
    tagAssignments,
    and(eq(tagAssignments.tagId, tagId), eq(tagAssignments.userId, userId)),
  );
}
