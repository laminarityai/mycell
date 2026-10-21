// Enablements' runs across a new version (M5): a new message runs the latest version for an
// enablement that followed it, and nothing for one a riskier version paused, while a run already
// under way finishes on the version it started on. The enablement is the admin's own, whose
// runs the admin may read; a member's pauses the same way (workflows' new-versions tests).
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { enable, publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { connectGoogle } from "@/testing/connect-helpers";
import { publishTo } from "@/testing/visibility-helpers";
import { executeRun, getRun, startTriggeredRuns } from "../server";
import type { RunStep } from "../types";
import { pricingQuestion, threadSpec } from "./run-helpers";

beforeEach(resetDatabase);

const readMessage = {
  id: "message",
  type: "tool",
  action: "google-mail.read-message",
  input: { messageId: { from: "trigger.messageId" } },
};
const readThread = {
  id: "thread",
  type: "tool",
  action: "google-mail.read-thread",
  input: { threadId: { from: "trigger.threadId" } },
};
const addLabel = {
  id: "label",
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
};

// Two read steps, so a run needs no model and has a step after its first.
const reads = (steps: unknown[] = [readMessage, readThread]) =>
  threadSpec({ id: "reads", steps, visibility: { tags: [] } });

// Org A: a read-only workflow is published, and the admin has it switched on for their own
// Google connection.
async function adminEnabled() {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const inbox = await connectGoogle(admin, orgA.admin.email);
  const { workflowId, version } = await publishTo(admin, "Reads", reads(), []);
  await enable(admin, workflowId);
  return { orgA, admin, inbox, workflowId, first: version };
}

async function publishSteps(admin: Ctx, workflowId: string, steps: unknown[]) {
  await saveWorkflow(admin, { workflowId, name: "Reads", spec: reads(steps) });
  return publishWorkflow(admin, workflowId);
}

// A new message in the admin's inbox, fanned out as discovery's event would be.
async function arrives(setup: Awaited<ReturnType<typeof adminEnabled>>) {
  const message = setup.inbox.mailbox.add(pricingQuestion({ at: new Date() }));
  return startTriggeredRuns(systemCtx(setup.orgA.id), {
    orgId: setup.orgA.id,
    connectionId: setup.inbox.id,
    sourceRef: message.id,
    occurredAt: new Date().toISOString(),
    labelIds: ["INBOX"],
  });
}

describe("a new message after a new version", () => {
  it("runs the new version when it needed nothing new", async () => {
    const setup = await adminEnabled();
    const second = await publishSteps(setup.admin, setup.workflowId, [readThread]);

    const { runIds } = await arrives(setup);

    expect(runIds).toHaveLength(1);
    expect((await getRun(setup.admin, runIds[0])).workflowVersionId).toBe(second.id);
  });

  it("starts nothing for an enablement a riskier version paused", async () => {
    const setup = await adminEnabled();
    await publishSteps(setup.admin, setup.workflowId, [readMessage, readThread, addLabel]);

    expect((await arrives(setup)).runIds).toEqual([]);
  });

  it("runs the riskier version once it's enabled again", async () => {
    const setup = await adminEnabled();
    const second = await publishSteps(setup.admin, setup.workflowId, [readMessage, addLabel]);
    await enable(setup.admin, setup.workflowId);

    const { runIds } = await arrives(setup);

    expect((await getRun(setup.admin, runIds[0])).workflowVersionId).toBe(second.id);
  });
});

describe("a run under way when a riskier version is published", () => {
  it("finishes on the version it started on", async () => {
    const setup = await adminEnabled();
    const [runId] = (await arrives(setup)).runIds;
    // Publishes the riskier version once the run's first step has finished.
    const runStep: RunStep = async (id, run) => {
      const result = await run();
      if (id === "message") {
        await publishSteps(setup.admin, setup.workflowId, [readMessage, readThread, addLabel]);
      }
      return result;
    };

    expect(await executeRun(systemCtx(setup.orgA.id), runId, runStep)).toEqual({
      status: "succeeded",
    });
    const run = await getRun(setup.admin, runId);
    expect(run.workflowVersionId).toBe(setup.first.id);
    expect(run.steps.map((step) => step.stepId)).toEqual(["message", "thread"]);
    expect(setup.inbox.mailbox.writes.log).toEqual([]);
  });
});
