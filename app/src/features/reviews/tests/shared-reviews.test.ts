// Shared reviews (ADR-0013): a review from an org connection's run is seen by everyone who sees
// its workflow through its tags, and by every admin, as the tags are on each read. The first to
// act wins; the others learn who handled it.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { unassignTag } from "@/features/tags/server";
import type { Ctx } from "@/lib/ctx";
import { AlreadyHandledError, NotFoundError } from "@/lib/errors";
import { approveReview, declineReview, listReviews, openReview } from "../server";
import { orgReview, REPLY } from "./review-helpers";

beforeEach(resetDatabase);

describe("an org review", () => {
  it("is seen by a member with the workflow's tag and by an admin, and not by an untagged member", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA, orgB } = orgs;
    const { reviewId, workflowId } = await orgReview(orgs);
    const untagged = await seedUser(orgA.id, "untagged@org-a.test", "member");

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      expect(await listReviews(ctx)).toMatchObject([
        { id: reviewId, workflowId, workflowName: "Support replies", handOff: null },
      ]);
      expect((await openReview(ctx, reviewId)).view).toMatchObject({ kind: "draft" });
    }
    for (const ctx of [untagged.ctx, orgB.admin.ctx, orgB.member.ctx]) {
      expect(await listReviews(ctx)).toEqual([]);
      await expect(openReview(ctx, reviewId)).rejects.toThrow(NotFoundError);
      await expect(approveReview(ctx, reviewId)).rejects.toThrow(NotFoundError);
    }
  });

  it("is sent from the shared inbox when a tagged member approves it", async () => {
    const orgs = await seedTwoOrgs();
    const { reviewId, mailbox, message } = await orgReview(orgs);

    await approveReview(orgs.orgA.member.ctx, reviewId);

    expect(mailbox.writes.sent).toMatchObject([{ threadId: message.threadId, text: REPLY }]);
    expect((await openReview(orgs.orgA.admin.ctx, reviewId)).review).toMatchObject({
      status: "approved",
      endedByUserId: orgs.orgA.member.id,
      endedBy: orgs.orgA.member.email,
    });
  });

  it("is sent once when two people approve it together, and the other is told it was handled", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const { reviewId, mailbox } = await orgReview(orgs);

    const results = await Promise.allSettled([
      approveReview(orgA.admin.ctx, reviewId),
      approveReview(orgA.member.ctx, reviewId),
    ]);

    expect(mailbox.writes.sent).toHaveLength(1);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    expect(refused).toEqual([expect.any(AlreadyHandledError)]);
  });

  it("names who handled it for whoever acts second", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const { reviewId, mailbox } = await orgReview(orgs);
    await approveReview(orgA.member.ctx, reviewId);

    const second = (ctx: Ctx) => declineReview(ctx, reviewId);

    await expect(second(orgA.admin.ctx)).rejects.toThrow(
      new AlreadyHandledError(orgA.member.email),
    );
    expect(mailbox.writes.sent).toHaveLength(1);
    expect(mailbox.drafts()).toEqual([]);
  });

  it("is no longer seen by a member the moment they lose the workflow's tag", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const { reviewId, sales, mailbox } = await orgReview(orgs);

    await unassignTag(orgA.admin.ctx, sales, orgA.member.id);

    expect(await listReviews(orgA.member.ctx)).toEqual([]);
    await expect(openReview(orgA.member.ctx, reviewId)).rejects.toThrow(NotFoundError);
    await expect(approveReview(orgA.member.ctx, reviewId)).rejects.toThrow(NotFoundError);
    expect(mailbox.writes.log).toEqual([]);
    expect(await listReviews(orgA.admin.ctx)).toHaveLength(1);
  });
});
