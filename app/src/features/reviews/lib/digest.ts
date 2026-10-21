// The daily digest (docs/architecture.md, "Notifications"): as each org's system ctx
// (ADR-0009), it first ends the reviews whose item is done or gone, then emails each person
// with a review waiting and the digest on. What a person's email counts is what their Reviews
// page lists: the same `listReviews`, read with their own ctx.
import { env } from "@/env";
import { digestTurnedOff, sendEmail, unsubscribeLink } from "@/features/notifications/server";
import { findCtx, listUsers } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import type { PendingForms } from "../types";
import { checkWaitingReviews } from "./acting";
import { digestEmail } from "./digest-email";
import { listReviews } from "./reviews";

/**
 * Sends the org's daily review digest; returns how many emails it sent. For the digest job, as
 * the org's system ctx: ForbiddenError for anyone else. Each email's idempotency key is the
 * person and `now`'s UTC day, so a retried job sends nobody a second digest that day.
 */
export async function sendReviewDigest(
  ctx: Ctx,
  options: { now?: Date; adapters?: PendingForms } = {},
): Promise<{ sent: number }> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const now = options.now ?? new Date();
  await checkWaitingReviews(ctx, options.adapters);
  const users = await listUsers(ctx);
  const off = await digestTurnedOff(
    ctx,
    users.map((user) => user.id),
  );
  let sent = 0;
  for (const user of users) {
    if (off.has(user.id)) continue;
    // The person as they are now, so their email lists exactly what their Reviews page does.
    const person = await findCtx(user.id);
    if (person?.orgId !== ctx.orgId) continue;
    const reviews = await listReviews(person);
    if (reviews.length === 0) continue;
    const email = digestEmail({
      to: user.email,
      reviews,
      now,
      reviewsUrl: new URL("/reviews", env.BETTER_AUTH_URL).toString(),
      unsubscribeUrl: unsubscribeLink(ctx, user.id),
    });
    const day = now.toISOString().slice(0, 10);
    await sendEmail(ctx, { ...email, idempotencyKey: `review-digest/${user.id}/${day}` });
    sent += 1;
  }
  return { sent };
}
