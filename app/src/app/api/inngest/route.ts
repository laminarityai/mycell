import { serve } from "inngest/next";
import { reconcileJob } from "@/features/connections/jobs";
import { backfillJob, pollCron, pollJob } from "@/features/discovery/jobs";
import { reviewDigestJob } from "@/features/reviews/jobs";
import { fanOutMessageJob, runWorkflowJob } from "@/features/runtime/jobs";
import { assignmentRemovedJob, tagDeletedJob } from "@/features/workflows/jobs";
import { inngest } from "@/lib/inngest";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    backfillJob,
    pollCron,
    pollJob,
    reconcileJob,
    fanOutMessageJob,
    runWorkflowJob,
    assignmentRemovedJob,
    tagDeletedJob,
    reviewDigestJob,
  ],
});
