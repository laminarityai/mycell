// The Inngest events the tags feature sends when someone may have lost sight of workflows. The
// workflows feature's jobs trigger on them to remove enablements nobody can see any more; tags
// itself knows nothing of workflows.
import { eventType } from "inngest";
import { z } from "zod";
import type { Ctx } from "@/lib/ctx";
import { inngest } from "@/lib/inngest";

/** Sent when a user loses a tag: they may no longer see workflows published to it. */
export const tagAssignmentRemoved = eventType("tags/assignment.removed", {
  schema: z.object({
    orgId: z.string().min(1),
    tagId: z.string().min(1),
    userId: z.string().min(1),
  }),
});

/** Sent when a tag is deleted: anyone who had it may no longer see workflows published to it. */
export const tagDeleted = eventType("tags/tag.deleted", {
  schema: z.object({ orgId: z.string().min(1), tagId: z.string().min(1) }),
});

export async function sendAssignmentRemoved(ctx: Ctx, tagId: string, userId: string) {
  await inngest.send(tagAssignmentRemoved.create({ orgId: ctx.orgId, tagId, userId }));
}

export async function sendTagDeleted(ctx: Ctx, tagId: string) {
  await inngest.send(tagDeleted.create({ orgId: ctx.orgId, tagId }));
}
