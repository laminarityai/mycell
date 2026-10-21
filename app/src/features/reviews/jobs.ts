// The reviews feature's Inngest functions. Thin: each calls server.ts, as the org's system ctx
// (ADR-0009). The digest is a cron, so it acts inside each org in turn.
import { cron } from "inngest";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import { gmailMessageSent } from "@/lib/events";
import { inngest } from "@/lib/inngest";
import { endReviewsInThread, sendReviewDigest } from "./server";

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
 * Every morning at 07:00 UTC, each org's daily review digest, one step per org: an org whose
 * step fails is retried alone, and its emails' idempotency keys keep anyone from a second one.
 */
export const reviewDigestJob = inngest.createFunction(
  {
    id: "review-digest",
    triggers: [cron("TZ=UTC 0 7 * * *")],
    // One run at a time: a slow run must not overlap the next.
    concurrency: [{ limit: 1 }],
  },
  async ({ step }) => {
    const orgIds = await step.run("list-orgs", () => listOrgIds());
    let sent = 0;
    for (const orgId of orgIds) {
      const digest = await step.run(`digest-${orgId}`, () => sendReviewDigest(systemCtx(orgId)));
      sent += digest.sent;
    }
    return { sent };
  },
);
