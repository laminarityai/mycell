// Each person's switch for the daily review digest: on until they turn it off, and theirs alone.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { reviewDigestOn, setReviewDigest } from "../server";

beforeEach(resetDatabase);

describe("the review digest setting", () => {
  it("is on until the person turns it off, and back on when they turn it on", async () => {
    const { orgA } = await seedTwoOrgs();

    expect(await reviewDigestOn(orgA.member.ctx)).toBe(true);
    await setReviewDigest(orgA.member.ctx, false);
    expect(await reviewDigestOn(orgA.member.ctx)).toBe(false);
    await setReviewDigest(orgA.member.ctx, false);
    expect(await reviewDigestOn(orgA.member.ctx)).toBe(false);
    await setReviewDigest(orgA.member.ctx, true);
    expect(await reviewDigestOn(orgA.member.ctx)).toBe(true);
  });

  it("turns it off for the caller only", async () => {
    const { orgA, orgB } = await seedTwoOrgs();

    await setReviewDigest(orgA.member.ctx, false);

    for (const ctx of [orgA.admin.ctx, orgB.admin.ctx, orgB.member.ctx]) {
      expect(await reviewDigestOn(ctx)).toBe(true);
    }
  });

  it("belongs to a person, so the system ctx has none", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(setReviewDigest(systemCtx(orgA.id), false)).rejects.toThrow(ForbiddenError);
    await expect(reviewDigestOn(systemCtx(orgA.id))).rejects.toThrow(ForbiddenError);
  });
});
