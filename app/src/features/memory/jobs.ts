// Memory's Inngest functions. Thin: each calls server.ts, as the org's system ctx (ADR-0009).
import "server-only";
import { cron } from "inngest";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import {
  calendarEventChanged,
  calendarEventRemoved,
  creditsGranted,
  itemChanged,
  itemRemoved,
  itemStored,
} from "@/lib/events";
import { inngest, stepRunner } from "@/lib/inngest";
import {
  exclusionAdded,
  itemQueued,
  memoryStarted,
  personForgotten,
  postponedDue,
  retentionDue,
  sendPostponedDue,
  sendRetentionDue,
} from "./lib/events";
import {
  applyRetention,
  deleteRemovedItem,
  forgetExcluded,
  forgetPersonAgain,
  learnFromItem,
  pruneAccessLog,
  queueStoredItems,
  rereadAccess,
  rereadAllAccess,
  resumePostponed,
} from "./server";

// One step of these jobs at a time per org, across them (scope "env"): learning, deletions,
// sharing changes, an exclusion's forgetting, forgetting a person, retention and resuming
// postponed items never run a step at the same time, and one org's backfill leaves other orgs
// unblocked. Inngest's concurrency limits executing steps, not runs: another job's step can run
// between two steps of one run, so each step checks again what it relies on (learning's second
// step re-checks the exclusions and the do-not-learn list).
const PER_ORG = [{ scope: "env", key: '"memory-org-" + event.data.orgId', limit: 1 }] as const;

// How many times Inngest runs a function by default: once, and 4 retries.
const DEFAULT_ATTEMPTS = 5;

/**
 * Learns from each item discovery stores, each Calendar event the Calendar poll finds made or
 * changed (a version learned already is skipped), and each item memory queues itself. One item
 * at a time per org, so two items never race to create the same object. On its last attempt, an
 * item the injection screen still fails on is postponed rather than lost.
 */
export const learnJob = inngest.createFunction(
  {
    id: "memory-learn-item",
    triggers: [itemStored, itemQueued, calendarEventChanged],
    concurrency: [...PER_ORG],
  },
  async ({ event, step, attempt, maxAttempts }) =>
    learnFromItem(
      systemCtx(event.data.orgId),
      {
        connectionId: event.data.connectionId,
        app: event.data.app,
        sourceRef: event.data.sourceRef,
      },
      stepRunner(step),
      { lastAttempt: attempt + 1 >= (maxAttempts ?? DEFAULT_ATTEMPTS) },
    ),
);

/** Once an admin starts memory, queues everything discovery stored before. */
export const startJob = inngest.createFunction(
  { id: "memory-start", triggers: [memoryStarted] },
  async ({ event, step }) => queueStoredItems(systemCtx(event.data.orgId), stepRunner(step)),
);

/** Forgets what memory learned from the items a new exclusion covers. */
export const forgetExcludedJob = inngest.createFunction(
  { id: "memory-forget-excluded", triggers: [exclusionAdded], concurrency: [...PER_ORG] },
  async ({ event, step }) =>
    forgetExcluded(systemCtx(event.data.orgId), event.data.exclusionId, stepRunner(step)),
);

/** Queues the items postponed again: for the reasons the event names, or every reason. */
export const resumePostponedJob = inngest.createFunction(
  { id: "memory-resume-postponed", triggers: [postponedDue], concurrency: [...PER_ORG] },
  async ({ event, step }) =>
    step.run("resume", () => resumePostponed(systemCtx(event.data.orgId), event.data.reasons)),
);

/** Once credits are granted, queues the items postponed for want of them again. */
export const resumeOnCreditsJob = inngest.createFunction(
  { id: "memory-resume-on-credits", triggers: [creditsGranted], concurrency: [...PER_ORG] },
  async ({ event, step }) =>
    step.run("resume", () => resumePostponed(systemCtx(event.data.orgId), ["credits"])),
);

/** Every hour, each org's items postponed while the injection screen kept failing are due. */
export const retryScreenCron = inngest.createFunction(
  { id: "memory-retry-screen-hourly", triggers: [cron("TZ=UTC 15 * * * *")] },
  async ({ step }) => {
    const orgIds = await step.run("list-orgs", () => listOrgIds());
    await step.run("fan-out", () => sendPostponedDue(orgIds, ["screen"]));
    return { orgs: orgIds.length };
  },
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

/** Deletes what memory learned from each item discovery, or the Calendar poll, finds gone. */
export const deleteRemovedItemJob = inngest.createFunction(
  {
    id: "memory-delete-removed-item",
    triggers: [itemRemoved, calendarEventRemoved],
    concurrency: [...PER_ORG],
  },
  async ({ event, step }) =>
    step.run("delete", () =>
      deleteRemovedItem(systemCtx(event.data.orgId), {
        connectionId: event.data.connectionId,
        app: event.data.app,
        itemId: event.data.itemId,
      }),
    ),
);

/**
 * Reads again who may see each Drive file discovery finds changed in place, and each Calendar
 * event the Calendar poll finds changed (its guests, perhaps, which leave its version as it was).
 */
export const rereadAccessJob = inngest.createFunction(
  {
    id: "memory-reread-access",
    triggers: [itemChanged, calendarEventChanged],
    concurrency: [...PER_ORG],
  },
  async ({ event, step }) =>
    step.run("reread", () =>
      rereadAccess(systemCtx(event.data.orgId), {
        connectionId: event.data.connectionId,
        app: event.data.app,
        sourceRef: event.data.sourceRef,
      }),
    ),
);

/**
 * Every night at 04:30 UTC, reads again who may see each Drive file and Calendar event memory
 * learned from, in each org: the backstop for a sharing change or removal the changes feed, or
 * the Calendar poll, missed.
 */
export const rereadAllAccessJob = inngest.createFunction(
  {
    id: "memory-reread-access-nightly",
    triggers: [cron("TZ=UTC 30 4 * * *")],
    // One run at a time: a slow run must not overlap the next.
    concurrency: [{ limit: 1 }],
  },
  async ({ step }) => {
    const orgIds = await step.run("list-orgs", () => listOrgIds());
    const run = stepRunner(step);
    let items = 0;
    for (const orgId of orgIds) {
      const done = await rereadAllAccess(systemCtx(orgId), (id, work) =>
        run(`${orgId}-${id}`, work),
      );
      items += done.items;
    }
    return { orgs: orgIds.length, items };
  },
);

/**
 * Deletes the objects keyed by an address an admin forgot, again: once any item being learned
 * when it was forgotten is stored (they share the per-org key), whatever it taught about the
 * person goes too.
 */
export const forgetPersonAgainJob = inngest.createFunction(
  { id: "memory-forget-person-again", triggers: [personForgotten], concurrency: [...PER_ORG] },
  async ({ event, step }) =>
    step.run("forget-again", () =>
      forgetPersonAgain(systemCtx(event.data.orgId), event.data.address),
    ),
);

/** Every night at 03:30 UTC, each org's retention is due. */
export const retentionCron = inngest.createFunction(
  { id: "memory-retention-nightly", triggers: [cron("TZ=UTC 30 3 * * *")] },
  async ({ step }) => {
    const orgIds = await step.run("list-orgs", () => listOrgIds());
    await step.run("fan-out", () => sendRetentionDue(orgIds));
    return { orgs: orgIds.length };
  },
);

/**
 * Deletes the org's source records past its retention window, and the facts and objects they
 * leave unsupported (ADR-0024).
 */
export const applyRetentionJob = inngest.createFunction(
  { id: "memory-apply-retention", triggers: [retentionDue], concurrency: [...PER_ORG] },
  async ({ event, step }) => step.run("apply", () => applyRetention(systemCtx(event.data.orgId))),
);
