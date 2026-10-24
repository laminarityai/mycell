import { serve } from "inngest/next";
import { reconcileJob } from "@/features/connections/jobs";
import { backfillJob, pollCron, pollJob, renewWatchesJob } from "@/features/discovery/jobs";
import {
  applyRetentionJob,
  deleteRemovedItemJob,
  forgetExcludedJob,
  forgetPersonAgainJob,
  learnJob,
  newMonthCron,
  pruneAccessLogJob,
  rereadAccessJob,
  rereadAllAccessJob,
  resumeOnCreditsJob,
  resumePostponedJob,
  retentionCron,
  retryScreenCron,
  startJob,
} from "@/features/memory/jobs";
import { failedCallCostJob } from "@/features/models/jobs";
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

// The one route Inngest calls to run the jobs' steps, and a step must end within one request.
// 300 s is what Vercel allows on every plan (docs/research/stack-verification.md §2), and far
// more than a step needs: each step's work is bounded (a page, a batch, a connection, one
// attempt at a run's step), a retry's backoff waits between steps, and a request to Nango gives
// up after a minute.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    backfillJob,
    pollCron,
    pollJob,
    renewWatchesJob,
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
    rereadAllAccessJob,
    forgetPersonAgainJob,
    retentionCron,
    applyRetentionJob,
    failedCallCostJob,
  ],
});
