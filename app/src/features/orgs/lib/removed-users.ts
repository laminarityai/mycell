// Removals: who an admin took out of the org, so signing in again doesn't rejoin them by
// ADR-0002's domain auto-join until an admin re-adds them. A removal is matched by user ID or by
// address: a Google account deleted and re-created under the same address gets a new ID, and the
// address is what the company's Workspace controls.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { getDb } from "@/db/client";
import { forOrg } from "@/db/for-org";
import { type Ctx, requireAdmin } from "@/lib/ctx";
import { InvariantError, NotFoundError, RemovedFromOrgError } from "@/lib/errors";
import type { RemovedUser } from "../types";
import { userNames } from "./list-users";
import { removedUsers } from "./schema";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** An address as a removal keeps it and sign-in compares it: trimmed and lowercased. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Records that the caller removed this user, inside removeUser's transaction so the removal and
 * the membership it ends land together. Written through that transaction rather than `forOrg`,
 * which can't join one that also deletes Better Auth's rows; the org comes from ctx all the same.
 */
export async function recordRemoval(
  tx: Tx,
  ctx: Ctx,
  removed: { userId: string; email: string },
): Promise<void> {
  const email = normalizeEmail(removed.email);
  await tx
    .insert(removedUsers)
    .values({
      id: randomUUID(),
      orgId: ctx.orgId,
      userId: removed.userId,
      email,
      removedBy: ctx.userId,
    })
    .onConflictDoUpdate({
      target: [removedUsers.orgId, removedUsers.userId],
      set: { email, removedBy: ctx.userId, removedAt: sql`now()` },
    });
}

/**
 * Throws RemovedFromOrgError when the org holds a removal for this user, by their ID or their
 * address. Sign-in calls it before joining someone to an existing org; there's no ctx yet, so the
 * org is the one their verified Workspace domain names.
 */
export async function assertNotRemoved(tx: Tx, orgId: string, userId: string): Promise<void> {
  const users = await tx.select({ email: user.email }).from(user).where(eq(user.id, userId));
  const found = users.at(0);
  if (found === undefined) throw new InvariantError("Signing in a user with no user row");
  const removals = await tx
    .select({ id: removedUsers.id })
    .from(removedUsers)
    .where(
      and(
        eq(removedUsers.orgId, orgId),
        or(eq(removedUsers.userId, userId), eq(removedUsers.email, normalizeEmail(found.email))),
      ),
    )
    .limit(1);
  if (removals.length > 0) throw new RemovedFromOrgError();
}

/** The org's removals, newest first, each with who removed them by name. Admins only. */
export async function listRemovedUsers(ctx: Ctx): Promise<RemovedUser[]> {
  requireAdmin(ctx);
  const [rows, nameOf] = await Promise.all([
    forOrg(ctx).select(removedUsers, {
      columns: ["id", "userId", "email", "removedBy", "removedAt"],
      orderBy: [desc(removedUsers.removedAt), asc(removedUsers.id)],
    }),
    userNames(ctx),
  ]);
  return rows.map((row) => ({ ...row, removedByName: nameOf(row.removedBy) }));
}

/**
 * Lifts a removal, admins only: the person joins as a member the next time they sign in. Any
 * other removal of the same user ID or address goes too, so nothing else still blocks them.
 */
export async function reAddUser(ctx: Ctx, removalId: string): Promise<void> {
  requireAdmin(ctx);
  const db = forOrg(ctx);
  const rows = await db.select(removedUsers, {
    columns: ["userId", "email"],
    where: eq(removedUsers.id, removalId),
  });
  const removal = rows.at(0);
  if (removal === undefined) throw new NotFoundError("removed person");
  await db.delete(
    removedUsers,
    or(
      eq(removedUsers.id, removalId),
      eq(removedUsers.userId, removal.userId),
      eq(removedUsers.email, removal.email),
    ),
  );
}
