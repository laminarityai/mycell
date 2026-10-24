// The agent's Inngest functions. Thin: each calls server.ts, as the org's system ctx (ADR-0009).
import "server-only";
import { cron } from "inngest";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import { inngest } from "@/lib/inngest";
import { deleteIdleConversations } from "./server";

/**
 * Every night at 04:30 UTC, deletes each org's Ask Mycel conversations nobody has used for 90
 * days (IDLE_CONVERSATION_DAYS), one step per org.
 */
export const deleteIdleConversationsJob = inngest.createFunction(
  {
    id: "agent-delete-idle-conversations",
    triggers: [cron("TZ=UTC 30 4 * * *")],
    // One run at a time: a slow run must not overlap the next.
    concurrency: [{ limit: 1 }],
  },
  async ({ step }) => {
    const orgIds = await step.run("list-orgs", () => listOrgIds());
    for (const orgId of orgIds) {
      await step.run(`delete-${orgId}`, () => deleteIdleConversations(systemCtx(orgId)));
    }
    return { orgs: orgIds.length };
  },
);
