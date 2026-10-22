// Memory's Inngest functions. Thin: each calls server.ts, as the org's system ctx (ADR-0009).
import { cron } from "inngest";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import { itemStored } from "@/lib/events";
import { inngest } from "@/lib/inngest";
import { learnFromItem, pruneAccessLog } from "./server";

// Step results are plain JSON already, so Inngest's serialized type is the same type.
const stepRunner =
  (step: { run: (id: string, run: () => Promise<unknown>) => Promise<unknown> }) =>
  <T>(id: string, run: () => Promise<T>) =>
    step.run(id, run) as Promise<T>;

/**
 * Learns from each item discovery stores. One item at a time per org, so two items never race
 * to create the same object, and one org's backfill leaves other orgs' learning unblocked.
 */
export const learnJob = inngest.createFunction(
  {
    id: "memory-learn-item",
    triggers: [itemStored],
    concurrency: [{ scope: "env", key: '"memory-org-" + event.data.orgId', limit: 1 }],
  },
  async ({ event, step }) =>
    learnFromItem(
      systemCtx(event.data.orgId),
      {
        connectionId: event.data.connectionId,
        app: event.data.app,
        sourceRef: event.data.sourceRef,
      },
      stepRunner(step),
    ),
);

/**
 * Every night at 04:00 UTC, deletes each org's access log entries older than the log keeps
 * them (ACCESS_LOG_RETENTION_DAYS), one step per org.
 */
export const pruneAccessLogJob = inngest.createFunction(
  {
    id: "memory-prune-access-log",
    triggers: [cron("TZ=UTC 0 4 * * *")],
    // One run at a time: a slow run must not overlap the next.
    concurrency: [{ limit: 1 }],
  },
  async ({ step }) => {
    const orgIds = await step.run("list-orgs", () => listOrgIds());
    for (const orgId of orgIds) {
      await step.run(`prune-${orgId}`, () => pruneAccessLog(systemCtx(orgId)));
    }
    return { orgs: orgIds.length };
  },
);
