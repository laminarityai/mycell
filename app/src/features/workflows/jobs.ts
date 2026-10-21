// The workflows feature's Inngest functions. Thin: each calls server.ts as the org's system ctx
// (ADR-0009). Until one runs, the trigger's fan-out already starts nothing for someone who
// can't see a workflow, so these only tidy up what admins and members are shown.
import { tagAssignmentRemoved, tagDeleted } from "@/features/tags/server";
import { systemCtx } from "@/lib/ctx";
import { inngest } from "@/lib/inngest";
import { removeInvisibleEnablements } from "./server";

/** A user lost a tag: their enablements of workflows they no longer see go. */
export const assignmentRemovedJob = inngest.createFunction(
  { id: "remove-enablements-after-unassign", triggers: [tagAssignmentRemoved] },
  async ({ event, step }) =>
    step.run("remove-enablements", () =>
      removeInvisibleEnablements(systemCtx(event.data.orgId), { userId: event.data.userId }),
    ),
);

/** A tag was deleted: anyone's enablements of workflows they no longer see go. */
export const tagDeletedJob = inngest.createFunction(
  { id: "remove-enablements-after-tag-deleted", triggers: [tagDeleted] },
  async ({ event, step }) =>
    step.run("remove-enablements", () =>
      removeInvisibleEnablements(systemCtx(event.data.orgId), {}),
    ),
);
