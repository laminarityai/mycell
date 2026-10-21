// The reviews feature's Inngest functions. Thin: each calls server.ts. The digest is a cron, so
// it acts inside each org as its system ctx (ADR-0009).
import { cron } from "inngest";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import { inngest } from "@/lib/inngest";
import { sendReviewDigest } from "./server";

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
