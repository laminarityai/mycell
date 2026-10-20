import { and, eq } from "drizzle-orm";
import { member, session } from "@/db/auth-schema";
import { getDb } from "@/db/client";
import type { Ctx, Role } from "@/lib/ctx";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function setRole(ctx: Ctx, userId: string, role: Role): Promise<void> {
  if (ctx.role !== "admin") throw new ForbiddenError();
  await getDb().transaction(async (tx) => {
    const target = await findMember(tx, ctx, userId);
    if (target.role === "admin" && role === "member") await assertNotLastAdmin(tx, ctx);
    await tx.update(member).set({ role }).where(eq(member.id, target.id));
  });
}

/** Ends the user's access at once: their membership goes, and so do their sessions. */
export async function removeUser(ctx: Ctx, userId: string): Promise<void> {
  if (ctx.role !== "admin") throw new ForbiddenError();
  await getDb().transaction(async (tx) => {
    const target = await findMember(tx, ctx, userId);
    if (target.role === "admin") await assertNotLastAdmin(tx, ctx);
    await tx.delete(member).where(eq(member.id, target.id));
    await tx.delete(session).where(eq(session.userId, userId));
  });
}

async function findMember(tx: Tx, ctx: Ctx, userId: string) {
  const rows = await tx
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, userId)));
  const row = rows.at(0);
  if (row === undefined) throw new NotFoundError("user");
  return row;
}

// Locks the org's admin rows, so two admins demoting or removing each other at once can't
// both pass: the second waits, then re-reads the admins that are left.
async function assertNotLastAdmin(tx: Tx, ctx: Ctx): Promise<void> {
  const admins = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, ctx.orgId), eq(member.role, "admin")))
    .for("update");
  if (admins.length <= 1) {
    throw new ConflictError("An org needs at least one admin. Make someone else an admin first.");
  }
}
