// The models feature's Inngest function. Thin: it calls server.ts, as the org's system ctx
// (ADR-0009).
import "server-only";
import { systemCtx } from "@/lib/ctx";
import { inngest } from "@/lib/inngest";
import { failedCallRecorded } from "./events";
import { correctFailedCallCost } from "./server";

// The gateway ingests a generation's usage a while after the call: the first lookup waits a few
// minutes, and each later one waits twice as long as the last, up to two hours, until the
// gateway knows the generation or a day has passed (`given_up`).
const FIRST_WAIT_MS = 3 * 60_000;
const LONGEST_WAIT_MS = 2 * 60 * 60_000;

/** Corrects a failed call's cost with what the gateway billed for it. */
export const failedCallCostJob = inngest.createFunction(
  { id: "models-failed-call-cost", triggers: [failedCallRecorded] },
  async ({ event, step }) => {
    const ctx = systemCtx(event.data.orgId);
    let waitMs = FIRST_WAIT_MS;
    for (let attempt = 1; ; attempt++) {
      await step.sleep(`wait-${String(attempt)}`, waitMs);
      const outcome = await step.run(`look-up-${String(attempt)}`, () =>
        correctFailedCallCost(ctx, event.data.entryId),
      );
      if (outcome !== "not_billed_yet") return { outcome, attempts: attempt };
      waitMs = Math.min(waitMs * 2, LONGEST_WAIT_MS);
    }
  },
);
