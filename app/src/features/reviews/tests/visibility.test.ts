// Who sees a review: a member's review is its owner's alone (ADR-0001). For an admin, another
// member and org B it doesn't exist, and nothing they try reaches its draft.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { disconnect } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import {
  approveEditedReview,
  approveReview,
  declineReview,
  listReviews,
  openReview,
} from "../server";
import { memberReview } from "./review-helpers";

beforeEach(resetDatabase);

describe("a member's review", () => {
  it("is listed for its owner only", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA, orgB } = orgs;
    await memberReview(orgs);
    const colleague = await seedUser(orgA.id, "colleague@org-a.test", "member");

    expect(await listReviews(orgA.member.ctx)).toHaveLength(1);
    for (const ctx of [orgA.admin.ctx, colleague.ctx, orgB.admin.ctx, orgB.member.ctx]) {
      expect(await listReviews(ctx)).toEqual([]);
    }
  });

  it("is not found for an admin, for another member, and for org B", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA, orgB } = orgs;
    const { mailbox } = await memberReview(orgs);
    const review = (await listReviews(orgA.member.ctx)).at(0);
    const id = review?.id ?? "";
    const colleague = await seedUser(orgA.id, "colleague@org-a.test", "member");

    const tries = [
      (ctx: Ctx) => openReview(ctx, id),
      (ctx: Ctx) => approveReview(ctx, id),
      (ctx: Ctx) => approveEditedReview(ctx, id, { text: "Sent by someone else." }),
      (ctx: Ctx) => declineReview(ctx, id),
    ];
    for (const ctx of [orgA.admin.ctx, colleague.ctx, orgB.admin.ctx, orgB.member.ctx]) {
      for (const attempt of tries) await expect(attempt(ctx)).rejects.toThrow(NotFoundError);
    }

    expect(mailbox.writes.log).toEqual([]);
    expect((await openReview(orgA.member.ctx, id)).review.status).toBe("waiting");
  });

  it("goes when its connection is disconnected", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const { google } = await memberReview(orgs);
    const review = (await listReviews(orgA.member.ctx)).at(0);

    await disconnect(orgA.member.ctx, google.id);

    expect(await listReviews(orgA.member.ctx)).toEqual([]);
    await expect(openReview(orgA.member.ctx, review?.id ?? "")).rejects.toThrow(NotFoundError);
  });
});
