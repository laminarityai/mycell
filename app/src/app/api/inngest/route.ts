import { serve } from "inngest/next";
import { reconcileJob } from "@/features/connections/jobs";
import { backfillJob, pollCron, pollJob } from "@/features/discovery/jobs";
import { checkWaitingReviewsJob, endedInGmailJob } from "@/features/reviews/jobs";
import {
  calendarPollCron,
  calendarPollJob,
  fanOutInviteJob,
  fanOutMessageJob,
  runWorkflowJob,
} from "@/features/runtime/jobs";
import { assignmentRemovedJob, tagDeletedJob, tagRenamedJob } from "@/features/workflows/jobs";
import { inngest } from "@/lib/inngest";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    backfillJob,
    pollCron,
    pollJob,
    reconcileJob,
    fanOutMessageJob,
    calendarPollCron,
    calendarPollJob,
    fanOutInviteJob,
    runWorkflowJob,
    assignmentRemovedJob,
    tagDeletedJob,
    tagRenamedJob,
    endedInGmailJob,
    checkWaitingReviewsJob,
  ],
});
