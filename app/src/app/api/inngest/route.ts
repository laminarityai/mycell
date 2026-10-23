import { serve } from "inngest/next";
import { reconcileJob } from "@/features/connections/jobs";
import { backfillJob, pollCron, pollJob } from "@/features/discovery/jobs";
import {
  applyRetentionJob,
  deleteRemovedItemJob,
  forgetExcludedJob,
  forgetPersonAgainJob,
  learnJob,
  newMonthCron,
  pruneAccessLogJob,
  rereadAccessJob,
  rereadDriveAccessJob,
  resumeOnCreditsJob,
  resumePostponedJob,
  retentionCron,
  retryScreenCron,
  startJob,
} from "@/features/memory/jobs";
import { failedCallCostJob } from "@/features/models/jobs";
import { checkWaitingReviewsJob, endedInGmailJob } from "@/features/reviews/jobs";
import { fanOutMessageJob, runWorkflowJob } from "@/features/runtime/jobs";
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
    runWorkflowJob,
    assignmentRemovedJob,
    tagDeletedJob,
    tagRenamedJob,
    endedInGmailJob,
    checkWaitingReviewsJob,
    learnJob,
    startJob,
    forgetExcludedJob,
    resumePostponedJob,
    resumeOnCreditsJob,
    retryScreenCron,
    newMonthCron,
    pruneAccessLogJob,
    deleteRemovedItemJob,
    rereadAccessJob,
    rereadDriveAccessJob,
    forgetPersonAgainJob,
    retentionCron,
    applyRetentionJob,
    failedCallCostJob,
  ],
});
