// The count of waiting reviews in the app's navigation: the reviews the caller would see listed,
// and no one else's.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { approveReview, countWaitingReviews, listReviews } from "../server";
import { memberReview } from "./review-helpers";

beforeEach(resetDatabase);

describe("countWaitingReviews", () => {
  it("counts the caller's own waiting reviews, and not other people's", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA, orgB } = orgs;
    await memberReview(orgs);
    const colleague = await seedUser(orgA.id, "colleague@org-a.test", "member");

    expect(await countWaitingReviews(orgA.member.ctx)).toBe(1);
    for (const ctx of [orgA.admin.ctx, colleague.ctx, orgB.admin.ctx, orgB.member.ctx]) {
      expect(await countWaitingReviews(ctx)).toBe(0);
    }
  });

  it("drops a review once it has ended", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    await memberReview(orgs);
    const review = (await listReviews(orgA.member.ctx)).at(0);

    await approveReview(orgA.member.ctx, review?.id ?? "");

    expect(await countWaitingReviews(orgA.member.ctx)).toBe(0);
  });
});
