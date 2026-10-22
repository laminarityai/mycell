// A review already waiting outlives what started its run: the draft is still in the member's
// mailbox, so losing the workflow's tag, or the workflow being archived, leaves the review on
// their Reviews page until it ends.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { unassignTag } from "@/features/tags/server";
import {
  archiveWorkflow,
  enable,
  listEnablements,
  removeInvisibleEnablements,
} from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";
import { connectMailbox } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import { approveReview, listReviews } from "../server";
import { REPLY, replySpec, reviewOn } from "./review-helpers";

beforeEach(resetDatabase);

// Org A: the member has `sales`, has the reply workflow on, and a draft it made waits for them.
async function waitingForMember() {
  const { orgA } = await seedTwoOrgs();
  const { admin, member } = orgA;
  const system = systemCtx(orgA.id);
  await connectMailbox(admin.ctx, admin.email);
  const sales = await tagUsers(admin.ctx, "sales", [member]);
  const { workflowId, version } = await publishTo(admin.ctx, "Pricing replies", replySpec(), [
    "sales",
  ]);
  const { mailbox } = await reviewOn(member.ctx, member.email, system, {
    workflowId,
    versionId: version.id,
  });
  await enable(member.ctx, workflowId);
  return { orgA, admin, member, system, sales, workflowId, mailbox };
}

describe("a review already waiting", () => {
  it("stays, and can be approved, after its member loses the workflow's tag and enablement", async () => {
    const { admin, member, system, sales, workflowId, mailbox } = await waitingForMember();

    await unassignTag(admin.ctx, sales, member.id);
    await removeInvisibleEnablements(system, { userId: member.id });
    expect(await listEnablements(admin.ctx, workflowId)).toEqual([]);

    const reviews = await listReviews(member.ctx);
    expect(reviews).toMatchObject([{ workflowId, workflowName: "Pricing replies" }]);
    await approveReview(member.ctx, reviews.at(0)?.id ?? "");
    expect(mailbox.writes.sent).toMatchObject([{ text: REPLY }]);
  });

  it("stays, and can be approved, after the workflow is archived", async () => {
    const { admin, member, workflowId, mailbox } = await waitingForMember();

    await archiveWorkflow(admin.ctx, workflowId);

    const reviews = await listReviews(member.ctx);
    expect(reviews).toMatchObject([{ workflowId, workflowName: "Pricing replies" }]);
    await approveReview(member.ctx, reviews.at(0)?.id ?? "");
    expect(mailbox.writes.sent).toMatchObject([{ text: REPLY }]);
  });
});
