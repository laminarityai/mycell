// The ship bar's measurement: how each review ended, counted per workflow and per member, and
// the share of ended approval reviews approved without edits. Admins see every count; a member
// sees only their own.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, type TwoOrgs } from "@/db/testing/two-org-fixture";
import { getWorkflow, publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { connectMailbox } from "@/testing/connect-helpers";
import {
  approveReview,
  listReviews,
  markDone,
  reviewCountsByWorkflow,
  reviewStats,
} from "../server";
import { memberEscalation } from "./escalation-helpers";
import { orgReview, publish, replySpec } from "./review-helpers";
import { counts, reviewEnded } from "./stats-helpers";

beforeEach(resetDatabase);

const HOUR_AGO = () => new Date(Date.now() - 60 * 60 * 1000);

/**
 * Org A's "Pricing replies" workflow runs on the member's and the admin's own mailboxes, and
 * "Other replies" on the member's. The member ended pricing reviews every way there is; the
 * admin approved one and has one waiting; the member approved one of the other workflow's.
 */
async function seeded() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  const system = systemCtx(orgA.id);
  const adminMailbox = await connectMailbox(orgA.admin.ctx, orgA.admin.email);
  const memberMailbox = await connectMailbox(orgA.member.ctx, orgA.member.email);
  const pricing = await publish(orgA.admin.ctx, replySpec(), "Pricing replies");
  const other = await publish(
    orgA.admin.ctx,
    { ...replySpec(), id: "other-replies" },
    "Other replies",
  );
  for (const ending of [
    "approved",
    "approved",
    "approved",
    "edited_approved",
    "declined",
    "done_in_app",
    "gone",
    "waiting",
  ] as const) {
    await reviewEnded(orgA.member, memberMailbox, system, pricing, ending);
  }
  await reviewEnded(orgA.admin, adminMailbox, system, pricing, "approved");
  await reviewEnded(orgA.admin, adminMailbox, system, pricing, "waiting");
  await reviewEnded(orgA.member, memberMailbox, system, other, "approved");
  return { orgs, pricing, other, memberMailbox, system };
}

function person(orgs: TwoOrgs, who: "admin" | "member") {
  const user = orgs.orgA[who];
  return { id: user.id, name: user.email };
}

describe("reviewStats", () => {
  it("counts a workflow's reviews by how they ended, and the share approved without edits", async () => {
    const { orgs, pricing } = await seeded();

    const stats = await reviewStats(orgs.orgA.admin.ctx, {
      workflowId: pricing.workflowId,
      since: HOUR_AGO(),
    });

    expect(stats).toEqual({
      approvals: counts({
        approved: 4,
        edited_approved: 1,
        declined: 1,
        done_in_app: 1,
        gone: 1,
        waiting: 2,
      }),
      escalations: counts(),
      heldSends: counts(),
      suggestedEdits: counts(),
      meetings: counts(),
      // 4 of approved 4, edited 1, declined 1, gone 1: sent from Gmail is left out.
      approvedWithoutEdits: 4 / 7,
      byUser: [],
    });
  });

  it("counts every workflow's reviews when no workflow is named", async () => {
    const { orgs } = await seeded();

    const stats = await reviewStats(orgs.orgA.admin.ctx, { since: HOUR_AGO() });

    expect(stats.approvals.approved).toBe(5);
    expect(stats.approvedWithoutEdits).toBe(5 / 8);
  });

  it("groups an admin's counts by member", async () => {
    const { orgs, pricing } = await seeded();

    const stats = await reviewStats(orgs.orgA.admin.ctx, {
      workflowId: pricing.workflowId,
      since: HOUR_AGO(),
      groupBy: "user",
    });

    expect(stats.byUser).toEqual([
      {
        user: person(orgs, "admin"),
        approvals: counts({ approved: 1, waiting: 1 }),
        escalations: counts(),
        heldSends: counts(),
        suggestedEdits: counts(),
        meetings: counts(),
        approvedWithoutEdits: 1,
      },
      {
        user: person(orgs, "member"),
        approvals: counts({
          approved: 3,
          edited_approved: 1,
          declined: 1,
          done_in_app: 1,
          gone: 1,
          waiting: 1,
        }),
        escalations: counts(),
        heldSends: counts(),
        suggestedEdits: counts(),
        meetings: counts(),
        approvedWithoutEdits: 3 / 6,
      },
    ]);
  });

  it("lets an admin ask about one member", async () => {
    const { orgs, pricing } = await seeded();

    const stats = await reviewStats(orgs.orgA.admin.ctx, {
      workflowId: pricing.workflowId,
      userId: orgs.orgA.admin.id,
      since: HOUR_AGO(),
    });

    expect(stats.approvals).toEqual(counts({ approved: 1, waiting: 1 }));
  });

  it("gives a member their own counts only", async () => {
    const { orgs, pricing } = await seeded();
    const member = orgs.orgA.member;

    const own = await reviewStats(member.ctx, {
      workflowId: pricing.workflowId,
      since: HOUR_AGO(),
    });
    const named = await reviewStats(member.ctx, {
      workflowId: pricing.workflowId,
      userId: member.id,
      since: HOUR_AGO(),
    });

    expect(own.approvals).toEqual(
      counts({
        approved: 3,
        edited_approved: 1,
        declined: 1,
        done_in_app: 1,
        gone: 1,
        waiting: 1,
      }),
    );
    expect(own.approvedWithoutEdits).toBe(0.5);
    expect(named).toEqual(own);
  });

  it("refuses a member another member's counts, or counts by member", async () => {
    const { orgs, pricing } = await seeded();
    const member = orgs.orgA.member.ctx;

    await expect(
      reviewStats(member, { userId: orgs.orgA.admin.id, since: HOUR_AGO() }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      reviewStats(member, { workflowId: pricing.workflowId, since: HOUR_AGO(), groupBy: "user" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("counts only the reviews made since `since`", async () => {
    const { orgs } = await seeded();

    const stats = await reviewStats(orgs.orgA.admin.ctx, {
      since: new Date(Date.now() + 60 * 1000),
    });

    expect(stats).toEqual({
      approvals: counts(),
      escalations: counts(),
      heldSends: counts(),
      suggestedEdits: counts(),
      meetings: counts(),
      approvedWithoutEdits: null,
      byUser: [],
    });
  });

  it("counts since the current version: only the reviews of runs on the latest version", async () => {
    const { orgs, pricing, memberMailbox, system } = await seeded();
    const admin = orgs.orgA.admin.ctx;
    const working = (await getWorkflow(admin, pricing.workflowId)).workingSpec;
    await saveWorkflow(admin, {
      workflowId: pricing.workflowId,
      name: "Pricing replies",
      // A minor change: the draft's instructions.
      spec: {
        ...working,
        steps: [
          { ...(working.steps[0] ?? {}), instructions: "Reply with this week's prices." },
          ...working.steps.slice(1),
        ],
      },
    });
    const v2 = await publishWorkflow(admin, pricing.workflowId);
    await reviewEnded(
      orgs.orgA.member,
      memberMailbox,
      system,
      { workflowId: pricing.workflowId, versionId: v2.id },
      "declined",
    );

    const stats = await reviewStats(admin, {
      workflowId: pricing.workflowId,
      since: "current_version",
    });

    expect(stats.approvals).toEqual(counts({ declined: 1 }));
    expect(stats.approvedWithoutEdits).toBe(0);
  });

  it("counts escalations apart, outside the share", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    await memberEscalation(orgs);
    const escalation = (await listReviews(orgA.member.ctx)).at(0);
    if (escalation === undefined) throw new Error("no escalation");
    await markDone(orgA.member.ctx, escalation.id);

    const stats = await reviewStats(orgA.member.ctx, { since: HOUR_AGO() });

    expect(stats.escalations).toEqual(counts({ done_in_app: 1 }));
    expect(stats.approvals).toEqual(counts());
    expect(stats.approvedWithoutEdits).toBeNull();
  });

  it("counts a shared inbox's reviews for admins, under no member, and not as a member's own", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const shared = await orgReview(orgs);
    await approveReview(orgA.member.ctx, shared.reviewId);

    const admin = await reviewStats(orgA.admin.ctx, { since: HOUR_AGO(), groupBy: "user" });
    const member = await reviewStats(orgA.member.ctx, { since: HOUR_AGO() });

    expect(admin.approvals).toEqual(counts({ approved: 1 }));
    expect(admin.byUser).toEqual([
      {
        user: null,
        approvals: counts({ approved: 1 }),
        escalations: counts(),
        heldSends: counts(),
        suggestedEdits: counts(),
        meetings: counts(),
        approvedWithoutEdits: 1,
      },
    ]);
    expect(member.approvals).toEqual(counts());
  });
});

describe("reviewCountsByWorkflow", () => {
  it("lists each workflow's counts with each person's under it for an admin", async () => {
    const { orgs, pricing, other } = await seeded();
    const workflows = [
      { id: pricing.workflowId, name: "Pricing replies" },
      { id: other.workflowId, name: "Other replies" },
    ];

    const rows = await reviewCountsByWorkflow(orgs.orgA.admin.ctx, workflows, "7d");

    expect(rows.map(({ label, person }) => [label, person ?? false])).toEqual([
      ["Pricing replies", false],
      [orgs.orgA.admin.email, true],
      [orgs.orgA.member.email, true],
      ["Other replies", false],
      [orgs.orgA.member.email, true],
    ]);
    expect(rows[0]?.tally.approvals.approved).toBe(4);
  });

  it("lists only a member's own counts, with no one under them", async () => {
    const { orgs, pricing } = await seeded();

    const rows = await reviewCountsByWorkflow(
      orgs.orgA.member.ctx,
      [{ id: pricing.workflowId, name: "Pricing replies" }],
      "current_version",
    );

    expect(rows.map(({ label }) => label)).toEqual(["Pricing replies"]);
    expect(rows[0]?.tally.approvals.approved).toBe(3);
  });

  it("counts nothing made before the period", async () => {
    const { orgs, pricing } = await seeded();
    const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const rows = await reviewCountsByWorkflow(
      orgs.orgA.admin.ctx,
      [{ id: pricing.workflowId, name: "Pricing replies" }],
      "2d",
      inAWeek,
    );

    expect(rows.map(({ label }) => label)).toEqual(["Pricing replies"]);
    expect(rows[0]?.tally).toMatchObject({ approvals: counts(), approvedWithoutEdits: null });
  });
});
