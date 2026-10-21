// The daily check: as each org's system ctx, it asks every waiting review's app where its item
// stands, and ends the reviews whose item was finished there or is gone, so the count in the
// navigation and the Reviews page list only what still waits.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { checkWaitingReviews, countWaitingReviews, listReviews, openReview } from "../server";
import { memberReview } from "./review-helpers";

beforeEach(resetDatabase);

describe("checkWaitingReviews", () => {
  it("ends a review whose draft was deleted as gone, and doesn't count it", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const { mailbox, draft } = await memberReview(orgs);
    const review = (await listReviews(orgA.member.ctx)).at(0);
    mailbox.deleteDraft(draft.id);

    await checkWaitingReviews(systemCtx(orgA.id));

    expect(await countWaitingReviews(orgA.member.ctx)).toBe(0);
    expect((await openReview(orgA.member.ctx, review?.id ?? "")).review.status).toBe("gone");
  });

  it("ends a review whose draft was sent from Gmail as done in the app", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const { mailbox, draft } = await memberReview(orgs);
    const review = (await listReviews(orgA.member.ctx)).at(0);
    mailbox.sendDraft(draft.id);

    await checkWaitingReviews(systemCtx(orgA.id));

    expect(await countWaitingReviews(orgA.member.ctx)).toBe(0);
    expect((await openReview(orgA.member.ctx, review?.id ?? "")).review.status).toBe("done_in_app");
  });

  it("leaves a review whose draft still waits in Gmail", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const { mailbox } = await memberReview(orgs);
    const before = await listReviews(orgA.member.ctx);

    await checkWaitingReviews(systemCtx(orgA.id));

    expect(await listReviews(orgA.member.ctx)).toEqual(before);
    expect(await countWaitingReviews(orgA.member.ctx)).toBe(1);
    expect(mailbox.writes.log).toEqual([]);
  });

  it("runs only as the org's system ctx", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const { mailbox, draft } = await memberReview(orgs);
    mailbox.deleteDraft(draft.id);

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      await expect(checkWaitingReviews(ctx)).rejects.toThrow(ForbiddenError);
    }
    expect(await countWaitingReviews(orgA.member.ctx)).toBe(1);
  });
});
