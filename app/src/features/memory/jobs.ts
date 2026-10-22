// Memory's Inngest functions. Thin: each calls server.ts, as the org's system ctx (ADR-0009).
import { cron } from "inngest";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import { itemStored } from "@/lib/events";
import { inngest } from "@/lib/inngest";
import {
  exclusionAdded,
  itemQueued,
  memoryStarted,
  postponedDue,
  sendPostponedDue,
} from "./lib/events";
import {
  forgetExcluded,
  learnFromItem,
  pruneAccessLog,
  queueStoredItems,
  resumePostponed,
} from "./server";

// Step results are plain JSON already, so Inngest's serialized type is the same type.
const stepRunner =
  (step: { run: (id: string, run: () => Promise<unknown>) => Promise<unknown> }) =>
  <T>(id: string, run: () => Promise<T>) =>
    step.run(id, run) as Promise<T>;

// One of these at a time per org, across the functions that change what memory holds: two items
// never race to create the same object, an exclusion's forgetting never races an item it
// covers, and one org's backfill leaves other orgs' learning unblocked.
const ONE_AT_A_TIME_PER_ORG: [{ scope: "env"; key: string; limit: number }] = [
  { scope: "env", key: '"memory-org-" + event.data.orgId', limit: 1 },
];

/** Learns from each item discovery stores, and each item memory queues itself. */
export const learnJob = inngest.createFunction(
  {
    id: "memory-learn-item",
    triggers: [itemStored, itemQueued],
    concurrency: ONE_AT_A_TIME_PER_ORG,
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

/** Once an admin starts memory, queues everything discovery stored before. */
export const startJob = inngest.createFunction(
  { id: "memory-start", triggers: [memoryStarted] },
  async ({ event, step }) => queueStoredItems(systemCtx(event.data.orgId), stepRunner(step)),
);

/** Forgets what memory learned from the items a new exclusion covers. */
export const forgetExcludedJob = inngest.createFunction(
  { id: "memory-forget-excluded", triggers: [exclusionAdded], concurrency: ONE_AT_A_TIME_PER_ORG },
  async ({ event, step }) =>
    forgetExcluded(systemCtx(event.data.orgId), event.data.exclusionId, stepRunner(step)),
);

/** Queues the items postponed for the budget again. */
export const resumePostponedJob = inngest.createFunction(
  { id: "memory-resume-postponed", triggers: [postponedDue], concurrency: ONE_AT_A_TIME_PER_ORG },
  async ({ event, step }) => step.run("resume", () => resumePostponed(systemCtx(event.data.orgId))),
);

/** At the start of each month (UTC), every org's budget is new: postponed items are due. */
export const newMonthCron = inngest.createFunction(
  { id: "memory-new-month", triggers: [cron("TZ=UTC 0 0 1 * *")] },
  async ({ step }) => {
    const orgIds = await step.run("list-orgs", () => listOrgIds());
    await step.run("fan-out", () => sendPostponedDue(orgIds));
    return { orgs: orgIds.length };
  },
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
