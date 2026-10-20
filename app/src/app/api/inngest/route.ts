import { serve } from "inngest/next";
import { reconcileJob } from "@/features/connections/jobs";
import { backfillJob, pollCron, pollJob } from "@/features/discovery/jobs";
import { inngest } from "@/lib/inngest";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [backfillJob, pollCron, pollJob, reconcileJob],
});
