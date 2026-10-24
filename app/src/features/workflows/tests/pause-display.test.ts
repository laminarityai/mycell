// How a pause shows where a switch is shown (M7): the first pause that holds, in M7's order, is
// the badge, and the notice explains each one that holds. Out of credits is worked out from the
// ledger, so the enablement's stored status never changes and a grant lifts it at once.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { FUNDED_CREDITS, seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { type Ctx, systemCtx } from "@/lib/ctx";
import { connectGoogle } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import {
  enable,
  getVisibleWorkflow,
  listEnablementsFor,
  listWorkflows,
  pauseForFailures,
  publishWorkflow,
  resumeWorkflow,
  saveWorkflow,
  switchWorkflowOn,
} from "../server";
import { PausedNotice, StateBadge, WorkflowsList } from "../ui";
import type { WorkflowSwitch } from "../types";
import { labelSpec } from "./specs";

beforeEach(resetDatabase);

const label = {
  id: "label",
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
};
// A drafted reply: an external send, riskier than a label.
const reply = {
  id: "reply",
  type: "draft",
  role: "smart",
  instructions: "Reply with our current prices.",
  context: ["trigger.message"],
  output: "google-mail.create-draft",
};

// Org A with `credits`: the member has `sales`, and a label workflow published to it is on for
// them, plus an org workflow on for the shared support inbox.
async function memberEnabled(credits: number) {
  const { orgA } = await seedTwoOrgs({ credits });
  const { admin, member } = orgA;
  await connectGoogle(admin.ctx, admin.email);
  await connectGoogle(member.ctx, member.email);
  const support = await connectGoogle(admin.ctx, "support@org-a.test", { kind: "org" });
  await tagUsers(admin.ctx, "sales", [member]);
  const own = await publishTo(admin.ctx, "Labels", labelSpec(), ["sales"]);
  const shared = await publishTo(
    admin.ctx,
    "Shared labels",
    labelSpec({ id: "shared-labels", credentials: "org" }),
    ["sales"],
  );
  await enable(member.ctx, own.workflowId);
  await switchWorkflowOn(admin.ctx, shared.workflowId, support.id);
  return { orgA, admin, member, workflowId: own.workflowId, sharedId: shared.workflowId };
}

// Publishes a riskier version: the member's enablement pauses until they re-enable it.
async function publishRiskier(admin: Ctx, workflowId: string) {
  const spec = labelSpec({ steps: [label, reply], visibility: { tags: ["sales"] } });
  await saveWorkflow(admin, { workflowId, name: "Labels", spec });
  await publishWorkflow(admin, workflowId);
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

describe("a switch while the company is out of credits", () => {
  it("shows a member's enablement as paused: out of credits, with its stored status still on", async () => {
    const { member, workflowId } = await memberEnabled(0);

    const { current, badge, notice } = await memberSees(member.ctx, workflowId);

    expect(badge).toBe("Paused: out of credits");
    expect(notice).toContain("Your company has run out of credits");
    expect(notice).toContain("once your company has more credits");
    expect(notice).toContain("Your switch stays on.");
    expect(current).toMatchObject<Partial<WorkflowSwitch>>({
      status: "on",
      pausedReason: null,
      pauses: ["out_of_credits"],
    });
  });

  it("shows an org switch on a member's card as paused: out of credits", async () => {
    const { member, sharedId } = await memberEnabled(0);

    const { badge, notice } = await memberSees(member.ctx, sharedId);

    expect(badge).toBe("Paused: out of credits");
    expect(notice).toContain("Its switch stays on.");
  });

  it("shows it on once credits are granted, with nothing to switch back on", async () => {
    const { orgA, member, workflowId } = await memberEnabled(0);

    await grantCredits(systemCtx(orgA.id), 10);

    const { badge, notice } = await memberSees(member.ctx, workflowId);
    expect(badge).toBe("On for your Google account");
    expect(notice).toBe("");
  });

  it("shows the admin's list with the pause on the org switch and on each enablement", async () => {
    const { admin, workflowId } = await memberEnabled(0);
    const workflows = await listWorkflows(admin.ctx);

    const page = text(
      createElement(WorkflowsList, {
        workflows,
        enablements: await listEnablementsFor(
          admin.ctx,
          workflows.map((workflow) => workflow.id),
        ),
        orgConnections: new Map(),
      }),
    );

    expect(page).toContain("member@org-a.test (paused: out of credits)");
    expect(page).toMatch(/Shared labels .*Paused: out of credits/);
    expect(workflows.find((workflow) => workflow.id === workflowId)?.switch).toBeNull();
  });
});

// The pairs of pauses that can hold together, each shown with the one first in M7's order.
describe("pauses that hold together", () => {
  it("shows out of credits before a riskier version waiting for the member's OK", async () => {
    const { orgA, admin, member, workflowId } = await memberEnabled(0);
    await publishRiskier(admin.ctx, workflowId);

    const both = await memberSees(member.ctx, workflowId);
    expect(both.badge).toBe("Paused: out of credits");
    expect(both.notice).toMatch(
      /run out of credits.*It's also paused: needs your OK for a riskier version\..*Its risk level went up.*until you switch it on again/,
    );
    expect(both.current?.pauses).toEqual(["out_of_credits", "needs_reenable"]);

    // A grant lifts the first: the one waiting for their OK is shown.
    await grantCredits(systemCtx(orgA.id), 10);
    const after = await memberSees(member.ctx, workflowId);
    expect(after.badge).toBe("Paused: needs your OK for a riskier version");
    expect(after.notice).not.toContain("credits");
  });

  it("shows failing after out of credits and before a version waiting for the member's OK", async () => {
    const { orgA, admin, member, workflowId } = await memberEnabled(0);
    await publishRiskier(admin.ctx, workflowId);
    await pauseForFailures(systemCtx(orgA.id), workflowId, ["r1", "r2", "r3"]);

    const all = await memberSees(member.ctx, workflowId);
    expect(all.current?.pauses).toEqual(["out_of_credits", "failures", "needs_reenable"]);
    expect(all.badge).toBe("Paused: out of credits");

    await grantCredits(systemCtx(orgA.id), 10);
    const after = await memberSees(member.ctx, workflowId);
    expect(after.badge).toBe("Paused: failing, an admin will look at it");
    expect(after.notice).toContain("It's also paused: needs your OK for a riskier version.");
  });
});

describe("a switch paused for failing", () => {
  it("shows a member's enablement and an org switch as paused: failing, until an admin resumes it", async () => {
    const { orgA, admin, member, workflowId, sharedId } = await memberEnabled(FUNDED_CREDITS);
    const system = systemCtx(orgA.id);
    for (const id of [workflowId, sharedId]) {
      await pauseForFailures(system, id, ["r1", "r2", "r3"]);
    }

    const own = await memberSees(member.ctx, workflowId);
    expect(own.badge).toBe("Paused: failing, an admin will look at it");
    expect(own.notice).toContain("Its last three runs failed");
    expect(own.notice).toContain("once an admin resumes it");
    expect(own.notice).toContain("Your switch stays on.");
    expect(own.current).toMatchObject<Partial<WorkflowSwitch>>({
      status: "on",
      pausedReason: null,
      pauses: ["failures"],
    });
    const shared = await memberSees(member.ctx, sharedId);
    expect(shared.badge).toBe("Paused: failing, an admin will look at it");
    expect(shared.notice).toContain("Its switch stays on.");

    await resumeWorkflow(admin.ctx, workflowId);
    expect((await memberSees(member.ctx, workflowId)).badge).toBe("On for your Google account");
  });
});
