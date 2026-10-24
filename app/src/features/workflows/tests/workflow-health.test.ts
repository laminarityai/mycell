// A workflow budget's pause where it's shown (M7): members see "Paused: budget reached" with
// their switch unchanged, and the admin's workflow page opens on its Health tab, which says what
// the workflow spent this month against its budget.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { FUNDED_CREDITS, seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { recordUsage } from "@/features/credits/server";
import { type Ctx, systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { connectGoogle } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import {
  enable,
  getVisibleWorkflow,
  getWorkflowHealth,
  pauseForFailures,
  publishWorkflow,
  saveWorkflow,
  switchWorkflowOn,
} from "../server";
import { PausedNotice, StateBadge, WorkflowHealthChecks, WorkflowTabs } from "../ui";
import type { WorkflowSwitch } from "../types";
import { labelSpec } from "./specs";

beforeEach(resetDatabase);

const BUDGET = 10;
const budget = (monthlyCredits = BUDGET) => ({ budget: { monthlyCredits } });

// Org A, funded with `credits`: the member has `sales`, and a label workflow with a budget,
// published to it, is on for them, plus an org workflow with a budget on for the support inbox.
async function budgeted(credits = FUNDED_CREDITS) {
  const { orgA } = await seedTwoOrgs({ credits });
  const { admin, member } = orgA;
  await connectGoogle(admin.ctx, admin.email);
  await connectGoogle(member.ctx, member.email);
  const support = await connectGoogle(admin.ctx, "support@org-a.test", { kind: "org" });
  await tagUsers(admin.ctx, "sales", [member]);
  const own = await publishTo(admin.ctx, "Labels", labelSpec(budget()), ["sales"]);
  const shared = await publishTo(
    admin.ctx,
    "Shared labels",
    labelSpec({ id: "shared-labels", credentials: "org", ...budget() }),
    ["sales"],
  );
  await enable(member.ctx, own.workflowId);
  await switchWorkflowOn(admin.ctx, shared.workflowId, support.id);
  return { orgA, admin, member, workflowId: own.workflowId, sharedId: shared.workflowId };
}

/** What the workflow's live runs spend: `credits`, as a run's model call records it. */
async function spend(orgId: string, workflowId: string, credits: number) {
  await recordUsage(systemCtx(orgId), {
    role: "fast",
    modelId: "openai/x",
    costUsd: credits / 1000,
    outcome: "succeeded",
    workflowId,
    runId: `run-${workflowId}`,
  });
}

async function memberSees(member: Ctx, workflowId: string) {
  const current = (await getVisibleWorkflow(member, workflowId)).switch;
  return {
    current,
    badge: text(createElement(StateBadge, { current })),
    notice: text(createElement(PausedNotice, { current })),
  };
}

function text(element: ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

describe("a switch once its workflow's budget is reached", () => {
  it("shows a member's enablement as paused: budget reached, with its stored status still on", async () => {
    const { orgA, member, workflowId } = await budgeted();
    await spend(orgA.id, workflowId, BUDGET);

    const { current, badge, notice } = await memberSees(member.ctx, workflowId);

    expect(badge).toBe("Paused: budget reached");
    expect(notice).toContain("spent its monthly credit budget");
    expect(notice).toContain("on the 1st of next month (UTC)");
    expect(notice).toContain("Your switch stays on.");
    expect(current).toMatchObject<Partial<WorkflowSwitch>>({
      status: "on",
      pausedReason: null,
      pauses: ["budget_reached"],
    });
  });

  it("shows an org switch as paused: budget reached, and leaves other workflows on", async () => {
    const { orgA, member, workflowId, sharedId } = await budgeted();
    await spend(orgA.id, sharedId, BUDGET + 1);

    expect((await memberSees(member.ctx, sharedId)).badge).toBe("Paused: budget reached");
    expect((await memberSees(member.ctx, workflowId)).badge).toBe("On for your Google account");
  });

  it("shows out of credits first, then the budget", async () => {
    const { orgA, member, workflowId } = await budgeted(BUDGET);
    // The whole balance, spent by this workflow's runs: both hold.
    await spend(orgA.id, workflowId, BUDGET);

    const { badge, notice } = await memberSees(member.ctx, workflowId);

    expect(badge).toBe("Paused: out of credits");
    expect(notice).toContain("It's also paused: budget reached.");
  });

  it("shows the budget ahead of a new version waiting for the member's OK", async () => {
    const { orgA, admin, member, workflowId } = await budgeted();
    await spend(orgA.id, workflowId, BUDGET);
    // A drafted reply: riskier than a label, so the member's enablement waits for their OK.
    const reply = {
      id: "reply",
      type: "draft",
      role: "smart",
      instructions: "Reply with our current prices.",
      context: ["trigger.message"],
      output: "google-mail.create-draft",
    };
    const riskier = labelSpec({ ...budget(), visibility: { tags: ["sales"] } });
    riskier.steps = [...(riskier.steps as unknown[]), reply];
    await saveWorkflow(admin.ctx, { workflowId, name: "Labels", spec: riskier });
    await publishWorkflow(admin.ctx, workflowId);

    const { current, badge, notice } = await memberSees(member.ctx, workflowId);

    expect(current?.pauses).toEqual(["budget_reached", "needs_reenable"]);
    expect(badge).toBe("Paused: budget reached");
    expect(notice).toContain("It's also paused: needs your OK for a riskier version.");
  });
});

describe("the workflow's Health tab", () => {
  it("says what it spent this month of its budget, and opens first once it's reached", async () => {
    const { orgA, admin, workflowId } = await budgeted();
    await spend(orgA.id, workflowId, BUDGET);

    const health = await getWorkflowHealth(admin.ctx, workflowId);
    const checks = text(createElement(WorkflowHealthChecks, { health, pausingRuns: [] }));
    const tabs = renderToStaticMarkup(
      createElement(WorkflowTabs, {
        paused: health.pauses.length > 0,
        editor: "editor",
        runs: "runs",
        health: "health",
      }),
    );

    expect(health).toMatchObject({
      pauses: ["budget_reached"],
      spentThisMonth: BUDGET,
      monthlyBudget: BUDGET,
    });
    expect(checks).toContain("Paused: budget reached.");
    expect(checks).toContain("The company has credits");
    expect(checks).toContain("Spent 10 of 10 credits this month");
    expect(checks).toContain("Budget reached. It starts again on");
    expect(activeTab(tabs)).toBe("Health");
    expect(tabs).toContain('aria-label="Paused"');
  });

  it("opens on the editor while nothing stops it, with what it spent so far", async () => {
    const { orgA, admin, workflowId } = await budgeted();
    await spend(orgA.id, workflowId, 4);

    const health = await getWorkflowHealth(admin.ctx, workflowId);
    const checks = text(createElement(WorkflowHealthChecks, { health, pausingRuns: [] }));
    const tabs = renderToStaticMarkup(
      createElement(WorkflowTabs, { paused: false, editor: "e", runs: "r", health: "h" }),
    );

    expect(health.pauses).toEqual([]);
    expect(checks).toContain("Running. Nothing stops it.");
    expect(checks).toContain("Spent 4 of 10 credits this month");
    expect(activeTab(tabs)).toBe("Editor");
    expect(tabs).not.toContain('aria-label="Paused"');
  });

  it("checks its runs' failures before its budget, with the runs that paused it and Resume", async () => {
    const { orgA, admin, workflowId } = await budgeted();
    await spend(orgA.id, workflowId, BUDGET);
    await pauseForFailures(systemCtx(orgA.id), workflowId, ["run-3", "run-2", "run-1"]);

    const health = await getWorkflowHealth(admin.ctx, workflowId);
    const pausingRuns = ["run-3", "run-2", "run-1"].map((runId) => ({
      runId,
      href: `/runs/${runId}`,
      finishedAt: new Date(),
      inbox: "Ada's inbox",
      failedStep: "label",
      error: "Gmail refused the request.",
    }));
    const markup = renderToStaticMarkup(
      createElement(WorkflowHealthChecks, { health, pausingRuns }),
    );
    const checks = text(createElement(WorkflowHealthChecks, { health, pausingRuns }));

    expect(health.pauses).toEqual(["failures", "budget_reached"]);
    expect(health.failurePause?.runIds).toEqual(["run-3", "run-2", "run-1"]);
    expect(checks).toContain("Paused: failing. It starts again once you resume it below");
    expect(checks).toContain("Paused: failing, since");
    expect(checks).toContain("Ada's inbox");
    expect(checks).toContain("Resume");
    expect(markup).toContain('href="/runs/run-3"');
    // Failing stops it first; the budget, reached too, waits behind it.
    expect(checks.indexOf("Paused: failing, since")).toBeLessThan(checks.indexOf("Spent 10 of 10"));
    expect(markup).toContain('aria-label="Stopped"');
    expect(markup).toContain('aria-label="Also"');
  });

  it("says its runs aren't failing while they don't pause it", async () => {
    const { admin, workflowId } = await budgeted();

    const health = await getWorkflowHealth(admin.ctx, workflowId);
    const checks = text(createElement(WorkflowHealthChecks, { health, pausingRuns: [] }));

    expect(health.failurePause).toBeNull();
    expect(checks).toContain("Its runs aren't failing");
    expect(checks).not.toContain("Resume");
  });

  it("says when the company is out of credits, and when there's no budget", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGoogle(admin, orgA.admin.email);
    const { workflowId } = await publishTo(admin, "Labels", labelSpec(), []);

    const health = await getWorkflowHealth(admin, workflowId);
    const checks = text(createElement(WorkflowHealthChecks, { health, pausingRuns: [] }));

    expect(health).toMatchObject({ pauses: ["out_of_credits"], monthlyBudget: null });
    expect(checks).toContain("The company is out of credits");
    expect(checks).toContain("Spent 0 credits this month, with no budget");
  });

  it("isn't paused before it's published", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGoogle(admin, orgA.admin.email);
    const { id } = await saveWorkflow(admin, { name: "Labels", spec: labelSpec() });

    expect((await getWorkflowHealth(admin, id)).pauses).toEqual([]);
  });

  it("is for admins only", async () => {
    const { member, workflowId } = await budgeted();

    await expect(getWorkflowHealth(member.ctx, workflowId)).rejects.toThrow(ForbiddenError);
  });
});

// The label of the tab Radix renders as the active one.
function activeTab(markup: string): string | undefined {
  const trigger = /<button[^>]*role="tab"[^>]*data-state="active"[^>]*>(.*?)<\/button>/.exec(
    markup,
  );
  return trigger?.[1]?.replace(/<[^>]+>/g, "").trim();
}
