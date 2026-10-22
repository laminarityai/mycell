// The reviews feature's Inngest functions. Thin: each calls server.ts, as the org's system ctx
// (ADR-0009). The daily check is a cron, so it acts inside each org in turn.
import { cron } from "inngest";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import { gmailMessageSent } from "@/lib/events";
import { inngest } from "@/lib/inngest";
import { checkWaitingReviews, endReviewsInThread } from "./server";

/**
 * A message was sent from a mailbox: ends the waiting reviews in its thread that their people
 * finished in Gmail themselves.
 */
export const endedInGmailJob = inngest.createFunction(
  {
    id: "reviews-ended-in-gmail",
    triggers: [gmailMessageSent],
    concurrency: [{ scope: "env", key: '"reviews-sent-" + event.data.connectionId', limit: 1 }],
  },
  async ({ event, step }) =>
    step.run("end-reviews", () => endReviewsInThread(systemCtx(event.data.orgId), event.data)),
);

/**
 * Every morning at 07:00 UTC, ends each org's waiting reviews whose item was finished in its app
 * or is gone, and expires held sends nobody ended within 30 days, one step per org: an org whose step fails is retried alone, and a retried step
 * only checks again the reviews still waiting.
 */
export const checkWaitingReviewsJob = inngest.createFunction(
  {
    id: "check-waiting-reviews",
    triggers: [cron("TZ=UTC 0 7 * * *")],
    // One run at a time: a slow run must not overlap the next.
    concurrency: [{ limit: 1 }],
  },
  async ({ step }) => {
    const orgIds = await step.run("list-orgs", () => listOrgIds());
    for (const orgId of orgIds) {
      await step.run(`check-${orgId}`, () => checkWaitingReviews(systemCtx(orgId)));
    }
    return { orgs: orgIds.length };
  },
);
