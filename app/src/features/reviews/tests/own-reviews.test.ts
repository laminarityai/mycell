// The reviews waiting for one person, for Ask Mycel (#181): their own, any handed to them, and
// the org reviews of workflows they see through their own tags. Being an admin adds none, so an
// admin's list is a member's with the same reviews and tags, never every review in the org.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { assignTag } from "@/features/tags/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { connectMailbox } from "@/testing/connect-helpers";
import { createReview, handOff, listOwnReviews, listReviews } from "../server";
import { memberReview, orgReview, publish, replySpec } from "./review-helpers";

beforeEach(resetDatabase);

describe("listOwnReviews", () => {
  it("lists a member's own review and their tagged org review, as the Reviews page does", async () => {
    const orgs = await seedTwoOrgs();
    const member = orgs.orgA.member.ctx;
    await memberReview(orgs);
    await orgReview(orgs);

    const own = await listOwnReviews(member);

    expect(own).toHaveLength(2);
    expect(own).toEqual(await listReviews(member));
  });

  it("narrows an admin's to the reviews waiting for them, not every org review", async () => {
    const orgs = await seedTwoOrgs();
    const { admin, member } = orgs.orgA;
    const { reviewId, sales } = await orgReview(orgs);
    // The Reviews page shows an admin every org review.
    expect((await listReviews(admin.ctx)).map((review) => review.id)).toEqual([reviewId]);

    expect(await listOwnReviews(admin.ctx)).toEqual([]);

    // With the member's tag, the admin's list is the member's.
    await assignTag(admin.ctx, sales, admin.id);
    expect(await listOwnReviews(admin.ctx)).toEqual(await listOwnReviews(member.ctx));
    expect((await listOwnReviews(admin.ctx)).map((review) => review.id)).toEqual([reviewId]);
  });

  it("includes a review handed to them", async () => {
    const orgs = await seedTwoOrgs();
    const { admin, member } = orgs.orgA;
    await memberReview(orgs, { handoff: true });
    const reviewId = (await listReviews(member.ctx)).at(0)?.id ?? "";
    await handOff(member.ctx, reviewId, admin.id);

    expect((await listOwnReviews(admin.ctx)).map((review) => review.id)).toEqual([reviewId]);
  });

  it("is for people only, not the system ctx", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(listOwnReviews(systemCtx(orgA.id))).rejects.toThrow(ForbiddenError);
  });
});

describe("listOwnReviews' query budget", () => {
  it("makes the same queries for 1 review as for 3", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const member = orgA.member.ctx;
    const system = systemCtx(orgA.id);
    await orgReview(orgs);
    // Publishing a member workflow needs the admin's own Gmail.
    await connectMailbox(orgA.admin.ctx, orgA.admin.email);
    const inbox = await connectMailbox(member, orgA.member.email);
    const reviewed = async (n: number) => {
      const spec = { ...replySpec(), id: `replies-${String(n)}` };
      const published = await publish(orgA.admin.ctx, spec, `Replies ${String(n)}`);
      await createReview(system, {
        runId: randomUUID(),
        connectionId: inbox.id,
        workflowId: published.workflowId,
        workflowVersionId: published.versionId,
        kind: "approval",
        itemRef: `draft-${String(n)}`,
        threadRef: `thread-${String(n)}`,
        sourceRef: `message-${String(n)}`,
      });
    };
    await reviewed(1);
    const one = await countQueries(() => listOwnReviews(member));
    await reviewed(2);
    await reviewed(3);
    const three = await countQueries(() => listOwnReviews(member));

    expect((await listOwnReviews(member)).length).toBe(4);
    expect(three.queries).toBe(one.queries);
  });
});
