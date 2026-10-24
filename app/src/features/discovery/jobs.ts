// Discovery's Inngest functions. Thin: each calls server.ts. The backfill runs as the user who
// connected the source; polling, started by a cron, as the org's system ctx (ADR-0009).
import "server-only";
import { connectionAppsGranted, connectionRecorded } from "@/features/connections/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { inngest, PER_ORG_LIMIT, stepRunner } from "@/lib/inngest";
import { connectionPollDue } from "./lib/events";
import {
  backfillConnection,
  markBackfillFailed,
  pollAllConnections,
  pollConnection,
} from "./server";

// Shared by the backfill and the poll (scope "env" keys them across functions): one ingest run
// per connection at a time, so cursors don't race, and a few per org. Both events carry
// `orgId` and `connectionId`.
const INGEST_CONCURRENCY = [
  { scope: "env", key: '"ingest-connection-" + event.data.connectionId', limit: 1 },
  { scope: "env", key: '"ingest-org-" + event.data.orgId', limit: PER_ORG_LIMIT },
] as const;

type EventData = { orgId: string; userId: string; role: Ctx["role"]; connectionId: string };

const ctxOf = (data: EventData): Ctx => ({
  orgId: data.orgId,
  userId: data.userId,
  role: data.role,
});

/**
 * Backfills a connection's apps once it's recorded, and the apps a reconnect grants it or
 * whose backfill it restarts, one page per step.
 */
export const backfillJob = inngest.createFunction(
  {
    id: "backfill-connection",
    triggers: [connectionRecorded, connectionAppsGranted],
    concurrency: [...INGEST_CONCURRENCY],
    onFailure: async ({ event }) => {
      const data = connectionRecorded.schema.parse(event.data.event.data);
      await markBackfillFailed(ctxOf(data), data.connectionId);
    },
  },
  async ({ event, step }) =>
    backfillConnection(ctxOf(event.data), event.data.connectionId, stepRunner(step)),
);

/** Every minute, sends one poll event per `active` connection in every org. */
export const pollCron = inngest.createFunction(
  { id: "poll-connections", triggers: [{ cron: "* * * * *" }] },
  async ({ step }) => {
    const due = await step.run("list-connections", () => pollAllConnections());
    if (due.length > 0) {
      await step.sendEvent(
        "fan-out",
        due.map((connection) => connectionPollDue.create(connection)),
      );
    }
    return { polls: due.length };
  },
);

/**
 * Polls one connection: what's new since its cursor, or a recovery if the cursor expired. A
 * burst of poll-due events for one connection (Gmail notifies up to once a second, ADR-0026)
 * becomes one poll, 5 seconds after the last; a steady stream still polls every 30 seconds.
 */
export const pollJob = inngest.createFunction(
  {
    id: "poll-connection",
    triggers: [connectionPollDue],
    concurrency: [...INGEST_CONCURRENCY],
    debounce: { key: "event.data.connectionId", period: "5s", timeout: "30s" },
  },
  async ({ event, step }) =>
    pollConnection(systemCtx(event.data.orgId), event.data.connectionId, stepRunner(step)),
);
