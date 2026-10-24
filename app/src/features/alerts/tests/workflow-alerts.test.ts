// The workflow alerts (#176): a workflow paused for failing, until an admin resumes it, and one
// whose live runs reached its monthly budget, until the budget is raised or the month ends. Both
// stop one workflow, so they come after credits out and before the connections.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { markBackfillFailed } from "@/features/discovery/server";
import {
  archiveWorkflow,
  getWorkflow,
  publishWorkflow,
  resumeWorkflow,
  saveWorkflow,
} from "@/features/workflows/server";
import { type Ctx, systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { connectGoogle, deliver } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { countAlerts, listAlerts } from "../server";
import { ALERT_URGENCY } from "../types";
import { labelSpec, pauseFailing, publishLabels, spendOn } from "@/testing/paused-workflow-helpers";

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
});

const kindsOf = async (ctx: Ctx) => (await listAlerts(ctx)).map((alert) => alert.kind);

/** Org A, funded, with an admin who can publish label workflows. */
async function adminOfOrgA() {
  const { orgA } = await seedTwoOrgs();
  await grantCredits(systemCtx(orgA.id), 10_000, "October allowance");
  await connectGoogle(orgA.admin.ctx, orgA.admin.email);
  return { orgA, admin: orgA.admin.ctx };
}

/** The start of today, UTC: the day every entry a test records falls on. */
function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

describe("a workflow paused for failing", () => {
  it("is an alert since its pause, linking to the workflow, until an admin resumes it", async () => {
    const { orgA, admin } = await adminOfOrgA();
    const id = await publishLabels(admin, "Pricing labels");
    await publishLabels(admin, "Untroubled");
    await pauseFailing(orgA.id, id);
    const pausedAt = (await getWorkflow(admin, id)).failurePause?.pausedAt;

    expect(await listAlerts(admin)).toEqual([
      {
        id: `workflow_failing:${id}`,
        kind: "workflow_failing",
        subject: { type: "workflow", id, name: "Pricing labels" },
        startedAt: pausedAt,
        sentence:
          "Its last 3 runs failed, so Mycel paused it for everyone: no new message starts a run until an admin resumes it.",
        clearsWhen: "Once an admin resumes it.",
        fix: { label: "Resume", href: `/workflows/${id}` },
      },
    ]);
    expect(pausedAt).toBeInstanceOf(Date);
    expect(await countAlerts(admin)).toBe(1);

    await resumeWorkflow(admin, id);

    expect(await listAlerts(admin)).toEqual([]);
    expect(await countAlerts(admin)).toBe(0);
  });
});

describe("a workflow at its budget", () => {
  it("is an alert from the day it was reached, until a raised budget is published", async () => {
    const { orgA, admin } = await adminOfOrgA();
    const id = await publishLabels(admin, "Pricing labels", 10);
    const under = await publishLabels(admin, "Under budget", 10);
    await spendOn(orgA.id, under, 9);
    await spendOn(orgA.id, id, 6);
    expect(await listAlerts(admin)).toEqual([]);

    await spendOn(orgA.id, id, 6);

    expect(await listAlerts(admin)).toEqual([
      {
        id: `budget_reached:${id}`,
        kind: "budget_reached",
        subject: { type: "workflow", id, name: "Pricing labels" },
        startedAt: today(),
        sentence:
          "Its live runs used this month's budget of 10 credits, so no new message starts a run until the budget is raised or the month ends.",
        clearsWhen: "Once the budget is raised or removed, or on the 1st (UTC).",
        fix: { label: "Raise the budget", href: `/workflows/${id}` },
      },
    ]);

    await saveWorkflow(admin, {
      workflowId: id,
      name: "Pricing labels",
      spec: labelSpec("pricing-labels", 20),
    });
    await publishWorkflow(admin, id);

    expect(await listAlerts(admin)).toEqual([]);
  });

  it("goes when its budget is removed", async () => {
    const { orgA, admin } = await adminOfOrgA();
    const id = await publishLabels(admin, "Pricing labels", 10);
    await spendOn(orgA.id, id, 10);
    expect(await countAlerts(admin)).toBe(1);

    await saveWorkflow(admin, {
      workflowId: id,
      name: "Pricing labels",
      spec: labelSpec("pricing-labels"),
    });
    await publishWorkflow(admin, id);

    expect(await countAlerts(admin)).toBe(0);
  });

  it("goes on the 1st of the next month, in UTC", async () => {
    const { orgA, admin } = await adminOfOrgA();
    const id = await publishLabels(admin, "Pricing labels", 10);
    await spendOn(orgA.id, id, 10);
    expect(await kindsOf(admin)).toEqual(["budget_reached"]);

    const now = new Date();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    expect(await kindsOf(admin)).toEqual([]);
  });
});

describe("which workflows alert, and where", () => {
  it("raises none for an archived workflow, failing and at its budget", async () => {
    const { orgA, admin } = await adminOfOrgA();
    const id = await publishLabels(admin, "Pricing labels", 10);
    await spendOn(orgA.id, id, 10);
    await pauseFailing(orgA.id, id);
    expect(await kindsOf(admin)).toEqual(["workflow_failing", "budget_reached"]);

    await archiveWorkflow(admin, id);

    expect(await listAlerts(admin)).toEqual([]);
  });

  it("puts both after credits out and before the connections, as stopping one workflow", async () => {
    // No credits granted: org A is out of them.
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    const mine = await connectGoogle(admin, orgA.admin.email);
    const shared = await connectGoogle(admin, `support@${orgA.workspaceDomain}`, { kind: "org" });
    await markBackfillFailed(systemCtx(orgA.id), mine.id);
    await deliver(fakeNango.authWebhook(shared.nangoConnectionId, "refresh", false));
    const spent = await publishLabels(admin, "Spent", 5);
    await spendOn(orgA.id, spent, 5);
    await pauseFailing(orgA.id, await publishLabels(admin, "Failing"));

    expect(await kindsOf(admin)).toEqual([
      "credits_out",
      "workflow_failing",
      "budget_reached",
      "connection_reconnect",
      "backfill_failed",
    ]);
    expect(ALERT_URGENCY.workflow_failing).toBe("one");
    expect(ALERT_URGENCY.budget_reached).toBe("one");
  });

  it("gives members none, even while a workflow is paused", async () => {
    const { orgA, admin } = await adminOfOrgA();
    await pauseFailing(orgA.id, await publishLabels(admin, "Pricing labels"));

    await expect(listAlerts(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
    await expect(countAlerts(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
  });
});
