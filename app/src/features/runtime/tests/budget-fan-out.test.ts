// The trigger's fan-out and workflow budgets (M7): a workflow whose live runs have spent its
// monthly budget this calendar month (UTC) starts no run, for an enablement or an org switch.
// It's worked out from the ledger whenever a message arrives, so a new month or a raised or
// removed budget (once published) lifts it, with nothing stored and nothing queued. Try it and
// the builder chat never count toward it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { FUNDED_CREDITS, seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { startConversation, streamTurn } from "@/features/builder/server";
import { publishWorkflow, saveWorkflow, switchWorkflowOn } from "@/features/workflows/server";
import { type Ctx, systemCtx } from "@/lib/ctx";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { dryRun, executeRun, startTriggeredRuns } from "../server";
import { pricingQuestion, threadSpec } from "./run-helpers";

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
});

const BUDGET = 10;

/**
 * Org A's admin with a member workflow switched on for their own inbox and an org workflow on
 * for the shared support inbox, each classify → branch → read the thread, with `budget`.
 */
async function budgeted(budget: number | null) {
  const { orgA } = await seedTwoOrgs({ credits: FUNDED_CREDITS });
  const admin = orgA.admin.ctx;
  const own = await connectGoogle(admin, orgA.admin.email);
  const support = await connectGoogle(admin, "support@org-a.test", { kind: "org" });
  const withBudget = budget === null ? {} : { budget: { monthlyCredits: budget } };
  const mine = await publish(admin, "Pricing", threadSpec(withBudget));
  const shared = await publish(
    admin,
    "Shared pricing",
    threadSpec({ id: "shared-pricing", credentials: "org", ...withBudget }),
  );
  await switchWorkflowOn(admin, mine, own.id);
  await switchWorkflowOn(admin, shared, support.id);
  const system = systemCtx(orgA.id);
  const inboxes = { [mine]: own, [shared]: support };

  /** Delivers a new message to `workflowId`'s inbox; the IDs of the runs it started. */
  const deliver = async (workflowId: string): Promise<string[]> => {
    const inbox = inboxes[workflowId];
    const message = inbox.mailbox.add(pricingQuestion({ at: new Date() }));
    const { runIds } = await startTriggeredRuns(system, {
      orgId: orgA.id,
      connectionId: inbox.id,
      sourceRef: message.id,
      occurredAt: new Date().toISOString(),
      labelIds: ["INBOX"],
    });
    return runIds;
  };

  /** A live run of `workflowId` whose classify call costs `credits`. */
  const spend = async (workflowId: string, credits: number) => {
    const runIds = await deliver(workflowId);
    expect(runIds).toHaveLength(1);
    const [runId] = runIds;
    // "no" ends the run at the branch: the classify call is all it spends.
    fakeAiGateway.decision(
      { choice: "no", probabilities: { yes: 0.1, no: 0.9 } },
      { costUsd: credits / 1000 },
    );
    await executeRun(system, runId);
  };

  return { orgA, admin, own, mine, shared, deliver, spend };
}

async function publish(admin: Ctx, name: string, spec: Record<string, unknown>) {
  const { id } = await saveWorkflow(admin, { name, spec });
  await publishWorkflow(admin, id);
  return id;
}

/** Publishes the workflow again with `budget` (or none), as an admin raising or removing it. */
async function republish(admin: Ctx, workflowId: string, budget: number | null) {
  await saveWorkflow(admin, {
    workflowId,
    name: "Pricing",
    spec: threadSpec(budget === null ? {} : { budget: { monthlyCredits: budget } }),
  });
  await publishWorkflow(admin, workflowId);
}

describe("fan-out and a workflow's budget", () => {
  it("starts runs while the workflow is under its budget", async () => {
    const { mine, deliver, spend } = await budgeted(BUDGET);
    await spend(mine, BUDGET - 1);

    expect(await deliver(mine)).toHaveLength(1);
  });

  it("starts nothing once its runs have spent exactly its budget", async () => {
    const { mine, deliver, spend } = await budgeted(BUDGET);
    await spend(mine, BUDGET);

    expect(await deliver(mine)).toEqual([]);
  });

  it("starts nothing over its budget, the run that crossed it having finished", async () => {
    const { mine, deliver, spend } = await budgeted(BUDGET);
    // Under the budget when it started: the run goes on to spend past it.
    await spend(mine, BUDGET + 5);

    expect(await deliver(mine)).toEqual([]);
  });

  it("pauses an org switch the same way, and only the workflow that spent its budget", async () => {
    const { mine, shared, deliver, spend } = await budgeted(BUDGET);
    await spend(shared, BUDGET);

    expect(await deliver(shared)).toEqual([]);
    expect(await deliver(mine)).toHaveLength(1);
  });

  it("starts runs again when the next month starts, in UTC", async () => {
    const { mine, deliver, spend } = await budgeted(BUDGET);
    await spend(mine, BUDGET);
    expect(await deliver(mine)).toEqual([]);

    const now = new Date();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 1));

    expect(await deliver(mine)).toHaveLength(1);
  });

  it("starts runs again from the next message once a raised budget is published", async () => {
    const { admin, mine, deliver, spend } = await budgeted(BUDGET);
    await spend(mine, BUDGET);
    expect(await deliver(mine)).toEqual([]);

    await republish(admin, mine, BUDGET * 3);

    expect(await deliver(mine)).toHaveLength(1);
  });

  it("starts runs again once a version without a budget is published", async () => {
    const { admin, mine, deliver, spend } = await budgeted(BUDGET);
    await spend(mine, BUDGET);

    await republish(admin, mine, null);

    expect(await deliver(mine)).toHaveLength(1);
  });

  it("limits a workflow without a budget only by the company's balance", async () => {
    const { mine, deliver, spend } = await budgeted(null);
    await spend(mine, 200);

    expect(await deliver(mine)).toHaveLength(1);
  });

  it("never counts Try it or the builder chat about the workflow toward its budget", async () => {
    const { admin, own, mine, deliver } = await budgeted(BUDGET);
    const message = own.mailbox.add(pricingQuestion());
    // Try it on the workflow's spec, costing three budgets.
    fakeAiGateway.decision(
      { choice: "no", probabilities: { yes: 0.1, no: 0.9 } },
      { costUsd: (3 * BUDGET) / 1000 },
    );
    await dryRun(admin, threadSpec({ budget: { monthlyCredits: BUDGET } }), {
      connectionId: own.id,
      sourceRef: message.id,
      workflowId: mine,
    });
    // A builder turn about the workflow, costing three more.
    const conversation = await startConversation(admin, { workflowId: mine });
    fakeAiGateway.reply({ text: "It labels pricing questions." }, { costUsd: (3 * BUDGET) / 1000 });
    await (await streamTurn(admin, conversation.id, "What does this do?")).text();

    expect(await deliver(mine)).toHaveLength(1);
  });
});
