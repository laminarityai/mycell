// The outbox's Inngest function. Thin: it calls server.ts, as each org's system ctx (ADR-0009).
import "server-only";
import { cron } from "inngest";
import { systemCtx } from "@/lib/ctx";
import { inngest } from "@/lib/inngest";
import { listOrgsWithWaitingEvents, sendWaitingEvents } from "./server";

/**
 * Every minute, sends the events that have waited in the outbox more than a minute, whose send
 * right after their change failed, one step per org: an org whose step fails is retried alone.
 */
export const sendWaitingEventsCron = inngest.createFunction(
  {
    id: "outbox-send-waiting",
    triggers: [cron("* * * * *")],
    // One run at a time: a slow run must not overlap the next.
    concurrency: [{ limit: 1 }],
  },
  async ({ step }) => {
    const orgIds = await step.run("list-orgs", () => listOrgsWithWaitingEvents());
    let sent = 0;
    for (const orgId of orgIds) {
      const done = await step.run(`send-${orgId}`, () => sendWaitingEvents(systemCtx(orgId)));
      sent += done.sent;
    }
    return { orgs: orgIds.length, sent };
  },
);
