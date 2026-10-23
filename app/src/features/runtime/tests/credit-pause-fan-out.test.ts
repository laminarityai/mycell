// The trigger's fan-out while the company is out of credits (M7): a balance at or below zero
// starts no run for any enablement or org switch, and a grant lets the next message start them
// again, with nothing stored when the pause starts or ends and nothing queued meanwhile.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits, recordUsage } from "@/features/credits/server";
import {
  enable,
  getVisibleWorkflow,
  listSwitchedOn,
  switchWorkflowOn,
} from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";
import type { GmailMessageReceived } from "@/lib/events";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import { startTriggeredRuns } from "../server";
import { threadSpec } from "./run-helpers";

beforeEach(resetDatabase);

// One read step: a run needs no model.
const readSpec = (id: string, overrides: Record<string, unknown> = {}) =>
  threadSpec({
    id,
    steps: [
      {
        id: "message",
        type: "tool",
        action: "google-mail.read-message",
        input: { messageId: { from: "trigger.messageId" } },
      },
    ],
    ...overrides,
  });

// Org A with `credits` granted: a member workflow the member has on, and an org workflow
// switched on for the shared support inbox.
async function switchedOn(credits: number) {
  const { orgA } = await seedTwoOrgs({ credits });
  const { admin, member } = orgA;
  // Saving checks the admin's own Gmail.
  await connectGoogle(admin.ctx, admin.email);
  const memberInbox = await connectGoogle(member.ctx, member.email);
  const support = await connectGoogle(admin.ctx, "support@org-a.test", { kind: "org" });
  await tagUsers(admin.ctx, "sales", [member]);
  const own = await publishTo(admin.ctx, "Reads", readSpec("reads"), ["sales"]);
  const shared = await publishTo(
    admin.ctx,
    "Shared reads",
    readSpec("shared-reads", { credentials: "org" }),
    ["sales"],
  );
  await enable(member.ctx, own.workflowId);
  await switchWorkflowOn(admin.ctx, shared.workflowId, support.id);
  return {
    orgA,
    system: systemCtx(orgA.id),
    inboxes: [memberInbox.id, support.id],
    workflowIds: [own.workflowId, shared.workflowId],
  };
}

let messages = 0;

function arrived(orgId: string, connectionId: string): GmailMessageReceived {
  messages += 1;
  return {
    orgId,
    connectionId,
    sourceRef: `message-${String(messages)}`,
    occurredAt: new Date().toISOString(),
    labelIds: ["INBOX"],
  };
}

/** Delivers one new message to each inbox, and returns the messages that started a run. */
async function deliverToEach(orgId: string, inboxes: string[]): Promise<string[]> {
  const system = systemCtx(orgId);
  const started: string[] = [];
  for (const inbox of inboxes) {
    const message = arrived(orgId, inbox);
    const { runIds } = await startTriggeredRuns(system, message);
    if (runIds.length > 0) started.push(message.sourceRef);
  }
  return started;
}

describe("fan-out while the company is out of credits", () => {
  it("starts no run for any enablement or org switch on a zero balance", async () => {
    const { orgA, inboxes } = await switchedOn(0);

    expect(await deliverToEach(orgA.id, inboxes)).toEqual([]);
    expect(fakeInngest.sent("runtime/run.requested")).toEqual([]);
  });

  it("starts no run on a balance below zero", async () => {
    const { orgA, system, inboxes } = await switchedOn(0);
    await recordUsage(system, {
      role: "fast",
      modelId: "openai/x",
      costUsd: 0.01,
      outcome: "succeeded",
    });

    expect(await deliverToEach(orgA.id, inboxes)).toEqual([]);
  });

  it("starts runs for every switch on a positive balance", async () => {
    const { orgA, inboxes } = await switchedOn(100);

    expect(await deliverToEach(orgA.id, inboxes)).toHaveLength(2);
  });

  it("starts runs again from the next message once credits are granted, never for one that arrived during the pause", async () => {
    const { orgA, system, inboxes } = await switchedOn(0);
    expect(await deliverToEach(orgA.id, inboxes)).toEqual([]);

    await grantCredits(system, 100);

    const after = await deliverToEach(orgA.id, inboxes);
    expect(after).toHaveLength(2);
    // Two runs requested in all, for the messages after the grant: those from the pause were
    // never queued.
    expect(fakeInngest.sent("runtime/run.requested")).toHaveLength(2);
  });

  it("keeps the member's enablement on, and lets a run under way go on checking its switch", async () => {
    const { orgA, system, inboxes, workflowIds } = await switchedOn(0);
    const [memberInbox] = inboxes;

    await deliverToEach(orgA.id, inboxes);

    expect((await getVisibleWorkflow(orgA.member.ctx, workflowIds[0])).switch).toMatchObject({
      status: "on",
      pausedReason: null,
    });
    // A run already under way finishes as today: what's switched on ignores the pause.
    expect(await listSwitchedOn(system, memberInbox)).toHaveLength(1);
  });
});
