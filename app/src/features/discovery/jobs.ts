// Discovery's Inngest functions. Thin: each calls server.ts, as the connection's owner.
import { connectionRecorded } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import { inngest } from "@/lib/inngest";
import { backfillConnection, markBackfillFailed } from "./server";

// At most this many backfills (and, with #15, polls) run at once for one org, so one org's
// large mailboxes leave other orgs' ingest unblocked.
const PER_ORG_LIMIT = 3;

type EventData = { orgId: string; userId: string; role: Ctx["role"]; connectionId: string };

const ctxOf = (data: EventData): Ctx => ({
  orgId: data.orgId,
  userId: data.userId,
  role: data.role,
});

/** Backfills a connection once it's recorded, one page per step. */
export const backfillJob = inngest.createFunction(
  {
    id: "backfill-connection",
    triggers: [connectionRecorded],
    // Keyed across functions (scope "env"), so polling can share them: one run per connection
    // at a time, so cursors don't race, and a few per org.
    concurrency: [
      { scope: "env", key: '"ingest-connection-" + event.data.connectionId', limit: 1 },
      { scope: "env", key: '"ingest-org-" + event.data.orgId', limit: PER_ORG_LIMIT },
    ],
    onFailure: async ({ event }) => {
      const data = connectionRecorded.schema.parse(event.data.event.data);
      await markBackfillFailed(ctxOf(data), data.connectionId);
    },
  },
  async ({ event, step }) =>
    // Step results are plain JSON already, so Inngest's serialized type is the same type.
    backfillConnection(
      ctxOf(event.data),
      event.data.connectionId,
      <T>(id: string, run: () => Promise<T>) => step.run(id, run) as Promise<T>,
    ),
);
