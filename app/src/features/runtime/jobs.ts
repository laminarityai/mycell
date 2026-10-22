// Runtime's Inngest functions. Thin: each calls server.ts. Runs act as their org's system ctx
// (ADR-0009).
import { systemCtx } from "@/lib/ctx";
import { gmailMessageReceived } from "@/lib/events";
import { inngest } from "@/lib/inngest";
import { calendarInviteReceived, calendarPollDue, runRequested } from "./lib/events";
import {
  calendarsDue,
  executeRun,
  pollCalendar,
  startInviteRuns,
  startTriggeredRuns,
} from "./server";
import type { Json, RunStep } from "./types";

// At most this many runs execute at once for one org, as for ingest.
const PER_ORG_LIMIT = 3;

// Step results are plain JSON already, so Inngest's serialized type is the same type.
const stepRunner =
  (step: { run: (id: string, run: () => Promise<unknown>) => Promise<unknown> }): RunStep =>
  <T extends Json>(id: string, run: () => Promise<T>) =>
    step.run(id, run) as Promise<T>;

/**
 * Starts the runs one new inbound message starts: one per enablement or org workflow switched
 * on for its connection. One step, so a retry after a crash re-runs it whole, and the runs'
 * unique trigger key and event IDs make that start nothing twice.
 */
export const fanOutMessageJob = inngest.createFunction(
  {
    id: "fan-out-message",
    triggers: [gmailMessageReceived],
    concurrency: [
      { scope: "env", key: '"fan-out-connection-" + event.data.connectionId', limit: 1 },
      { scope: "env", key: '"fan-out-org-" + event.data.orgId', limit: PER_ORG_LIMIT },
    ],
  },
  async ({ event, step }) =>
    step.run("start-runs", () => startTriggeredRuns(systemCtx(event.data.orgId), event.data)),
);

/** Starts the runs one new invite starts, as the message fan-out does for a new message. */
export const fanOutInviteJob = inngest.createFunction(
  {
    id: "fan-out-invite",
    triggers: [calendarInviteReceived],
    concurrency: [
      { scope: "env", key: '"fan-out-connection-" + event.data.connectionId', limit: 1 },
      { scope: "env", key: '"fan-out-org-" + event.data.orgId', limit: PER_ORG_LIMIT },
    ],
  },
  async ({ event, step }) =>
    step.run("start-runs", () => startInviteRuns(systemCtx(event.data.orgId), event.data)),
);

/** Every minute, sends one poll event per calendar a Calendar-triggered workflow watches. */
export const calendarPollCron = inngest.createFunction(
  { id: "poll-calendars", triggers: [{ cron: "* * * * *" }] },
  async ({ step }) => {
    const due = await step.run("list-calendars", () => calendarsDue());
    if (due.length > 0) {
      await step.sendEvent(
        "fan-out",
        due.map((calendar) => calendarPollDue.create(calendar)),
      );
    }
    return { polls: due.length };
  },
);

/** Polls one connection's calendar for new invites, one at a time per connection. */
export const calendarPollJob = inngest.createFunction(
  {
    id: "poll-calendar",
    triggers: [calendarPollDue],
    concurrency: [
      { scope: "env", key: '"calendar-poll-" + event.data.connectionId', limit: 1 },
      { scope: "env", key: '"calendar-poll-org-" + event.data.orgId', limit: PER_ORG_LIMIT },
    ],
  },
  async ({ event, step }) =>
    pollCalendar(systemCtx(event.data.orgId), event.data.connectionId, stepRunner(step)),
);

/**
 * Executes one run, one spec step per Inngest step. A step's attempts and backoff run inside
 * the step, which records its failure rather than throwing it, so Inngest's own retries are
 * left for infrastructure errors (the database unreachable, say).
 */
export const runWorkflowJob = inngest.createFunction(
  {
    id: "run-workflow",
    triggers: [runRequested],
    retries: 2,
    concurrency: [
      { scope: "env", key: '"run-connection-" + event.data.connectionId', limit: 1 },
      { scope: "env", key: '"run-org-" + event.data.orgId', limit: PER_ORG_LIMIT },
    ],
  },
  async ({ event, step }) =>
    executeRun(systemCtx(event.data.orgId), event.data.runId, stepRunner(step)),
);
