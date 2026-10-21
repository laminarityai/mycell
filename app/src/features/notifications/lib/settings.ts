// Each person's notification settings. A person changes only their own; the system ctx, which
// sends the digest, reads everyone's in its org.
import { and, eq, inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { userSettings } from "./schema";

/** Whether the caller gets the daily review digest. On unless they turned it off. */
export async function reviewDigestOn(ctx: Ctx): Promise<boolean> {
  requirePerson(ctx);
  const row = (
    await forOrg(ctx).select(userSettings, { where: eq(userSettings.userId, ctx.userId) })
  ).at(0);
  return row?.reviewDigest ?? true;
}

/** Turns the caller's daily review digest on or off. */
export async function setReviewDigest(ctx: Ctx, on: boolean): Promise<void> {
  requirePerson(ctx);
  const db = forOrg(ctx);
  const mine = eq(userSettings.userId, ctx.userId);
  const set = { reviewDigest: on, updatedAt: new Date() };
  if ((await db.update(userSettings, set, mine)).length > 0) return;
  const inserted = await db.insert(
    userSettings,
    { userId: ctx.userId, ...set },
    { onConflictDoNothing: true },
  );
  // Someone else's request inserted the row first: apply this one over it.
  if (inserted.length === 0) await db.update(userSettings, set, mine);
}

/**
 * Which of these users turned the daily review digest off. For the digest job, as the org's
 * system ctx (ADR-0009): ForbiddenError for anyone else.
 */
export async function digestTurnedOff(ctx: Ctx, userIds: readonly string[]): Promise<Set<string>> {
  if (ctx.role !== "system") throw new ForbiddenError();
  if (userIds.length === 0) return new Set();
  const rows = await forOrg(ctx).select(userSettings, {
    where: and(inArray(userSettings.userId, [...userIds]), eq(userSettings.reviewDigest, false)),
  });
  return new Set(rows.map((row) => row.userId));
}

// Settings are a person's own: the system ctx is no person.
function requirePerson(ctx: Ctx): void {
  if (ctx.role === "system") throw new ForbiddenError();
}
