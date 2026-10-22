// Memory's Inngest functions. Thin: each calls server.ts. Learning runs as the org's system ctx
// (ADR-0009).
import { systemCtx } from "@/lib/ctx";
import { itemStored } from "@/lib/events";
import { inngest } from "@/lib/inngest";
import { learnFromItem } from "./server";

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
