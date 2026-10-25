// The workflows feature's Inngest functions. Thin: each calls server.ts as the org's system ctx
// (ADR-0009). Until a cleanup runs, the trigger's fan-out already starts nothing for someone who
// can't see a workflow, so those only tidy up what admins and members are shown.
import "server-only";
import { tagAssignmentRemoved, tagDeleted, tagRenamed } from "@/features/tags/events";
import { systemCtx } from "@/lib/ctx";
import { inngest } from "@/lib/inngest";
import { followTagRename, removeInvisibleEnablements } from "./server";

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

/**
 * A tag was renamed: working specs naming it follow it, so the next publish finds it. One at a
 * time per org, so two renames' rewrites don't race each other.
 */
export const tagRenamedJob = inngest.createFunction(
  {
    id: "follow-tag-rename",
    triggers: [tagRenamed],
    concurrency: { key: "event.data.orgId", limit: 1 },
  },
  async ({ event, step }) =>
    step.run("follow-rename", () =>
      followTagRename(systemCtx(event.data.orgId), {
        tagId: event.data.tagId,
        from: event.data.from,
      }),
    ),
);
