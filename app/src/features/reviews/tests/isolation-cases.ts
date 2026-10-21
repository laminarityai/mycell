import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import * as server from "../server";
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
});
