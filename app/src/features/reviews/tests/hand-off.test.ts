// Handing a review on (ADR-0013): when its workflow allows it, a review goes to a colleague,
// who sees it with who handed it to them and acts on it through the review's own connection.
// A member's own review is handed on by that member alone (ADR-0001).
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { publishWorkflow } from "@/features/workflows/server";
import { AlreadyHandledError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  approveReview,
  declineReview,
  handOff,
  listReviews,
  markDone,
  openReview,
} from "../server";
import { memberEscalation } from "./escalation-helpers";
import { memberReview, orgReview, REPLY } from "./review-helpers";

beforeEach(resetDatabase);

/** Org A's member has a review waiting on their own mailbox; its workflow allows hand-off. */
async function handOffable() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  const seeded = await memberReview(orgs, { handoff: true });
  const review = (await listReviews(orgA.member.ctx)).at(0);
  if (review === undefined) throw new Error("no review");
  const colleague = await seedUser(orgA.id, "colleague@org-a.test", "member");
  return { ...orgs, ...seeded, owner: orgA.member, colleague, reviewId: review.id };
}

describe("handing a member's review on", () => {
  it("lets the colleague see it and approve it, sending from the owner's mailbox", async () => {
    const { owner, colleague, reviewId, mailbox, message } = await handOffable();

    await handOff(owner.ctx, reviewId, colleague.id);

    const handedOn = {
      to: { id: colleague.id, name: colleague.email },
      by: { id: owner.id, name: owner.email },
    };
    expect(await listReviews(colleague.ctx)).toMatchObject([{ id: reviewId, handOff: handedOn }]);
    expect(await listReviews(owner.ctx)).toMatchObject([{ id: reviewId, handOff: handedOn }]);
    expect((await openReview(colleague.ctx, reviewId)).view).toMatchObject({ kind: "draft" });

    await approveReview(colleague.ctx, reviewId);

    expect(mailbox.writes.sent).toMatchObject([{ threadId: message.threadId, text: REPLY }]);
    expect((await openReview(owner.ctx, reviewId)).review).toMatchObject({
      status: "approved",
      endedByUserId: colleague.id,
    });
  });

  it("is refused to anyone but the owner, the colleague it was handed to included", async () => {
    const { orgA, owner, colleague, reviewId } = await handOffable();
    const another = await seedUser(orgA.id, "another@org-a.test", "member");

    // An admin doesn't see a member's review at all.
    await expect(handOff(orgA.admin.ctx, reviewId, colleague.id)).rejects.toThrow(NotFoundError);
    await handOff(owner.ctx, reviewId, colleague.id);
    await expect(handOff(colleague.ctx, reviewId, another.id)).rejects.toThrow(ForbiddenError);

    expect(await listReviews(another.ctx)).toEqual([]);
  });

  it("can be handed to someone else, and the first colleague no longer sees it", async () => {
    const { orgA, owner, colleague, reviewId } = await handOffable();
    const another = await seedUser(orgA.id, "another@org-a.test", "member");
    await handOff(owner.ctx, reviewId, colleague.id);

    await handOff(owner.ctx, reviewId, another.id);

    expect(await listReviews(colleague.ctx)).toEqual([]);
    await expect(declineReview(colleague.ctx, reviewId)).rejects.toThrow(NotFoundError);
    expect(await listReviews(another.ctx)).toHaveLength(1);
  });

  it("offers the org's other users as colleagues to the owner, and nobody to the colleague", async () => {
    const { orgA, owner, colleague, reviewId } = await handOffable();

    const offered = (await openReview(owner.ctx, reviewId)).handOffTo;

    expect(offered.map((user) => user.id).sort()).toEqual([orgA.admin.id, colleague.id].sort());
    await handOff(owner.ctx, reviewId, colleague.id);
    expect((await openReview(colleague.ctx, reviewId)).handOffTo).toEqual([]);
  });
});

describe("handing an escalation on", () => {
  it("lets the colleague open it, with its Gmail link, and mark it done", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    await memberEscalation(orgs, "orgA", { handoff: true });
    const escalation = (await listReviews(orgA.member.ctx)).at(0);
    const id = escalation?.id ?? "";
    const colleague = await seedUser(orgA.id, "colleague@org-a.test", "member");

    await handOff(orgA.member.ctx, id, colleague.id);

    expect((await openReview(colleague.ctx, id)).view).toMatchObject({
      kind: "message",
      link: expect.stringContaining(encodeURIComponent(orgA.member.email)) as string,
    });
    await markDone(colleague.ctx, id);
    expect((await openReview(orgA.member.ctx, id)).review.status).toBe("done_in_app");
  });
});

describe("hand-off", () => {
  it("is refused when the workflow doesn't allow it", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    await memberReview(orgs);
    const review = (await listReviews(orgA.member.ctx)).at(0);
    const colleague = await seedUser(orgA.id, "colleague@org-a.test", "member");

    await expect(handOff(orgA.member.ctx, review?.id ?? "", colleague.id)).rejects.toThrow(
      ForbiddenError,
    );

    expect(await listReviews(colleague.ctx)).toEqual([]);
    expect((await openReview(orgA.member.ctx, review?.id ?? "")).handOffTo).toEqual([]);
  });

  it("follows the workflow's latest version", async () => {
    const { orgA, owner, colleague, reviewId, workflowId } = await handOffableWithWorkflow();

    await publishWorkflow(orgA.admin.ctx, workflowId, { handoff: false });

    await expect(handOff(owner.ctx, reviewId, colleague.id)).rejects.toThrow(ForbiddenError);
  });

  it("is not found for a user in org B", async () => {
    const { orgB, owner, reviewId } = await handOffable();

    for (const target of [orgB.admin.id, orgB.member.id, "nobody"]) {
      await expect(handOff(owner.ctx, reviewId, target)).rejects.toThrow(NotFoundError);
    }
    expect(await listReviews(orgB.member.ctx)).toEqual([]);
  });

  it("refuses handing a review to yourself, and one no longer waiting", async () => {
    const { owner, colleague, reviewId } = await handOffable();

    await expect(handOff(owner.ctx, reviewId, owner.id)).rejects.toThrow(ValidationError);
    await approveReview(owner.ctx, reviewId);
    await expect(handOff(owner.ctx, reviewId, colleague.id)).rejects.toThrow(AlreadyHandledError);
  });
});

describe("handing an org review on", () => {
  it("is open to anyone who sees it, and reaches an untagged colleague", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const { reviewId, mailbox } = await orgReview(orgs, { handoff: true });
    const untagged = await seedUser(orgA.id, "untagged@org-a.test", "member");

    await handOff(orgA.member.ctx, reviewId, untagged.id);
    await approveReview(untagged.ctx, reviewId);

    expect(mailbox.writes.sent).toHaveLength(1);
  });

  it("is refused when the workflow doesn't allow it", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const { reviewId } = await orgReview(orgs);

    await expect(handOff(orgA.admin.ctx, reviewId, orgA.member.id)).rejects.toThrow(ForbiddenError);
  });
});

async function handOffableWithWorkflow() {
  const handed = await handOffable();
  const review = (await listReviews(handed.owner.ctx)).at(0);
  if (review === undefined) throw new Error("no review");
  return { ...handed, workflowId: review.workflowId };
}
