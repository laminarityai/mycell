import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { fakeEmail } from "@/testing/fake-email";
import * as server from "../server";
import { memberEscalation } from "./escalation-helpers";
import { memberReview } from "./review-helpers";

// Org B's member has a review waiting. Org A's users, admin included, can't reach it.
async function orgBReview(orgs: TwoOrgs) {
  const seeded = await memberReview(orgs, { org: "orgB" });
  const review = (await server.listReviews(orgs.orgB.member.ctx)).at(0);
  if (review === undefined) throw new Error("no review in org B");
  return { ...seeded, review };
}

function orgAUsers(orgs: TwoOrgs): Ctx[] {
  return [orgs.orgA.admin.ctx, orgs.orgA.member.ctx];
}

// Org B's review is still waiting, its draft untouched.
async function untouched(orgs: TwoOrgs, b: Awaited<ReturnType<typeof orgBReview>>) {
  expect(b.mailbox.writes.log).toEqual([]);
  expect(b.mailbox.drafts()).toHaveLength(1);
  expect(await server.listReviews(orgs.orgB.member.ctx)).toEqual([b.review]);
}

export const isolationCases = defineIsolationCases(server, {
  createReview: async (orgs) => {
    const b = await orgBReview(orgs);

    await expect(
      server.createReview(systemCtx(orgs.orgA.id), {
        runId: randomUUID(),
        connectionId: b.google.id,
        workflowId: b.review.workflowId,
        workflowVersionId: randomUUID(),
        kind: "approval",
        itemRef: b.draft.id,
        threadRef: b.message.threadId,
        sourceRef: b.message.id,
      }),
    ).rejects.toThrow(NotFoundError);
    await untouched(orgs, b);
  },

  listReviews: async (orgs) => {
    const b = await orgBReview(orgs);

    for (const ctx of [...orgAUsers(orgs), systemCtx(orgs.orgA.id)]) {
      expect(await server.listReviews(ctx)).toEqual([]);
    }
    await untouched(orgs, b);
  },

  countWaitingReviews: async (orgs) => {
    const b = await orgBReview(orgs);

    for (const ctx of [...orgAUsers(orgs), systemCtx(orgs.orgA.id)]) {
      expect(await server.countWaitingReviews(ctx)).toBe(0);
    }
    expect(await server.countWaitingReviews(orgs.orgB.member.ctx)).toBe(1);
    await untouched(orgs, b);
  },

  // Org A's digest neither emails org B's people nor checks (and so ends) org B's reviews.
  sendReviewDigest: async (orgs) => {
    const b = await orgBReview(orgs);
    b.mailbox.deleteDraft(b.draft.id);

    expect(await server.sendReviewDigest(systemCtx(orgs.orgA.id))).toEqual({ sent: 0 });

    expect(fakeEmail.sent()).toEqual([]);
    expect(await server.listReviews(orgs.orgB.member.ctx)).toEqual([b.review]);
  },

  openReview: async (orgs) => {
    const b = await orgBReview(orgs);

    for (const ctx of orgAUsers(orgs)) {
      await expect(server.openReview(ctx, b.review.id)).rejects.toThrow(NotFoundError);
    }
    await untouched(orgs, b);
  },

  approveReview: async (orgs) => {
    const b = await orgBReview(orgs);

    for (const ctx of orgAUsers(orgs)) {
      await expect(server.approveReview(ctx, b.review.id)).rejects.toThrow(NotFoundError);
    }
    await untouched(orgs, b);
  },

  approveEditedReview: async (orgs) => {
    const b = await orgBReview(orgs);

    for (const ctx of orgAUsers(orgs)) {
      await expect(
        server.approveEditedReview(ctx, b.review.id, { text: "From org A" }),
      ).rejects.toThrow(NotFoundError);
    }
    await untouched(orgs, b);
  },

  declineReview: async (orgs) => {
    const b = await orgBReview(orgs);

    for (const ctx of orgAUsers(orgs)) {
      await expect(server.declineReview(ctx, b.review.id)).rejects.toThrow(NotFoundError);
    }
    await untouched(orgs, b);
  },

  handOff: async (orgs) => {
    const b = await orgBReview(orgs);

    for (const ctx of orgAUsers(orgs)) {
      const colleague = ctx.userId === orgs.orgA.admin.id ? orgs.orgA.member : orgs.orgA.admin;
      await expect(server.handOff(ctx, b.review.id, colleague.id)).rejects.toThrow(NotFoundError);
      await expect(server.handOff(ctx, b.review.id, orgs.orgB.admin.id)).rejects.toThrow(
        NotFoundError,
      );
    }
    await untouched(orgs, b);
  },

  markDone: async (orgs) => {
    await memberEscalation(orgs, "orgB");
    const escalation = (await server.listReviews(orgs.orgB.member.ctx)).at(0);
    if (escalation === undefined) throw new Error("no escalation in org B");

    for (const ctx of orgAUsers(orgs)) {
      await expect(server.markDone(ctx, escalation.id)).rejects.toThrow(NotFoundError);
    }
    expect(await server.listReviews(orgs.orgB.member.ctx)).toEqual([escalation]);
  },
});
