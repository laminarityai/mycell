// The connections feature's Inngest functions. Thin: each calls server.ts.
import "server-only";
import { cron } from "inngest";
import { inngest, stepRunner } from "@/lib/inngest";
import { reconcileConnections } from "./server";

/**
 * Reconciles Mycel's connections with Nango's every night, at 03:00 UTC: one step reading both
 * sides, then one per connection it acts on.
 */
export const reconcileJob = inngest.createFunction(
  {
    id: "reconcile-connections",
    triggers: [cron("TZ=UTC 0 3 * * *")],
    // One run at a time: a slow run must not overlap the next.
    concurrency: [{ limit: 1 }],
  },
  async ({ step }) => reconcileConnections(new Date(), stepRunner(step)),
);
