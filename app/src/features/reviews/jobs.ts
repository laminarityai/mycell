// Reviews' Inngest functions. Thin: each calls server.ts, as the org's system ctx (ADR-0009).
import { systemCtx } from "@/lib/ctx";
import { gmailMessageSent } from "@/lib/events";
import { inngest } from "@/lib/inngest";
import { endReviewsInThread } from "./server";

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
