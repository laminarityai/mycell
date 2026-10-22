// Memory's Inngest functions. Thin: each calls server.ts, as the org's system ctx (ADR-0009).
import { cron } from "inngest";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import { itemChanged, itemRemoved, itemStored } from "@/lib/events";
import { inngest } from "@/lib/inngest";
import {
  deleteRemovedItem,
  learnFromItem,
  pruneAccessLog,
  rereadAccess,
  rereadDriveAccess,
} from "./server";

// Step results are plain JSON already, so Inngest's serialized type is the same type.
const stepRunner =
  (step: { run: (id: string, run: () => Promise<unknown>) => Promise<unknown> }) =>
  <T>(id: string, run: () => Promise<T>) =>
    step.run(id, run) as Promise<T>;

// One of these jobs at a time per org, across them (scope "env"): learning, deletions and
// sharing changes never race each other, and one org's backfill leaves other orgs unblocked.
const PER_ORG = [{ scope: "env", key: '"memory-org-" + event.data.orgId', limit: 1 }] as const;

/**
 * Learns from each item discovery stores. One item at a time per org, so two items never race
 * to create the same object.
 */
export const learnJob = inngest.createFunction(
  { id: "memory-learn-item", triggers: [itemStored], concurrency: [...PER_ORG] },
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

/** Deletes what memory learned from each item discovery finds gone from its app. */
export const deleteRemovedItemJob = inngest.createFunction(
  { id: "memory-delete-removed-item", triggers: [itemRemoved], concurrency: [...PER_ORG] },
  async ({ event, step }) =>
    step.run("delete", () =>
      deleteRemovedItem(systemCtx(event.data.orgId), {
        connectionId: event.data.connectionId,
        app: event.data.app,
        itemId: event.data.itemId,
      }),
    ),
);

/** Reads again who may see each Drive file discovery finds changed in place. */
export const rereadAccessJob = inngest.createFunction(
  { id: "memory-reread-access", triggers: [itemChanged], concurrency: [...PER_ORG] },
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
 * Every night at 04:30 UTC, reads again who may see each Drive file memory learned from, in
 * each org: the backstop for a sharing change or removal the changes feed missed.
 */
export const rereadDriveAccessJob = inngest.createFunction(
  {
    id: "memory-reread-drive-access",
    triggers: [cron("TZ=UTC 30 4 * * *")],
    // One run at a time: a slow run must not overlap the next.
    concurrency: [{ limit: 1 }],
  },
  async ({ step }) => {
    const orgIds = await step.run("list-orgs", () => listOrgIds());
    const run = stepRunner(step);
    let files = 0;
    for (const orgId of orgIds) {
      const done = await rereadDriveAccess(systemCtx(orgId), (id, work) =>
        run(`${orgId}-${id}`, work),
      );
      files += done.files;
    }
    return { orgs: orgIds.length, files };
  },
);
