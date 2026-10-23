// Reviews their people finished in the app itself, outside Mycel: a draft sent from Gmail, or an
// escalated message replied to there. Discovery's poll announces each message sent from a
// mailbox, and each waiting review in its thread on its connection asks its adapter whether
// its item is done. Mycel can't tell whether a draft sent from Gmail was edited first, so it
// ends `done_in_app`, not `approved`.
import { and, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { type Ctx, requireSystem } from "@/lib/ctx";
import type { GmailMessageSent } from "@/lib/events";
import type { PendingForms } from "../types";
import { checkWaiting } from "./acting";
import { reviews } from "./schema";

/**
 * Checks each waiting review in the sent message's thread on its connection, ending those whose
 * item its adapter says is done in its app (or gone). Nothing else is checked. For the job
 * that hears of the sent message, as the org's system ctx.
 */
export async function endReviewsInThread(
  ctx: Ctx,
  sent: Pick<GmailMessageSent, "connectionId" | "threadId">,
  adapters?: PendingForms,
): Promise<void> {
  requireSystem(ctx);
  const waiting = await forOrg(ctx).select(reviews, {
    where: and(
      eq(reviews.connectionId, sent.connectionId),
      eq(reviews.threadRef, sent.threadId),
      eq(reviews.status, "waiting"),
    ),
  });
  for (const row of waiting) await checkWaiting(ctx, row, adapters);
}
