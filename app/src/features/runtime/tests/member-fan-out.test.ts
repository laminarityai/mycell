// The trigger's fan-out for members' enablements (M5): a message starts runs only for the
// enablements on its own connection that are on, whose user can still see the workflow, and
// whose connection Google still accepts.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { startReconnect } from "@/features/connections/server";
import { unassignTag } from "@/features/tags/server";
import { disable, enable, getVisibleWorkflow } from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";
import type { GmailMessageReceived } from "@/lib/events";
import { connectGoogle, deliver } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { fakeNango } from "@/testing/fake-nango";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import { getRun, startTriggeredRuns } from "../server";
import { threadSpec } from "./run-helpers";

beforeEach(resetDatabase);

// One read step: a run needs no model.
const readSpec = threadSpec({
  id: "reads",
  steps: [
    {
      id: "message",
      type: "tool",
      action: "google-mail.read-message",
      input: { messageId: { from: "trigger.messageId" } },
    },
  ],
});

// Org A: the member has `sales`, a workflow is published to it, and both the member and the
// admin have it switched on for their own Google connection.
async function bothEnabled() {
  const { orgA } = await seedTwoOrgs();
  const { admin, member } = orgA;
  const adminInbox = await connectGoogle(admin.ctx, admin.email);
  const memberInbox = await connectGoogle(member.ctx, member.email);
  const salesTag = await tagUsers(admin.ctx, "sales", [member]);
  const { workflowId } = await publishTo(admin.ctx, "Reads", readSpec, ["sales"]);
  await enable(member.ctx, workflowId);
  await enable(admin.ctx, workflowId);
  return { orgA, admin, member, adminInbox, memberInbox, salesTag, workflowId };
}

let messages = 0;

// A message arriving now on the connection, as discovery announces it.
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

describe("fanning a message out to members' enablements", () => {
  it("starts a run only for the enablement on the message's own connection", async () => {
    const { orgA, admin, memberInbox, adminInbox, workflowId } = await bothEnabled();
    const system = systemCtx(orgA.id);

    const forMember = await startTriggeredRuns(system, arrived(orgA.id, memberInbox.id));
    const forAdmin = await startTriggeredRuns(system, arrived(orgA.id, adminInbox.id));

    expect(forMember.runIds).toHaveLength(1);
    expect(forAdmin.runIds).toHaveLength(1);
    expect(fakeInngest.sent("runtime/run.requested").map((event) => event.data)).toEqual([
      { orgId: orgA.id, runId: forMember.runIds[0], connectionId: memberInbox.id },
      { orgId: orgA.id, runId: forAdmin.runIds[0], connectionId: adminInbox.id },
    ]);
    expect(await getRun(admin.ctx, forAdmin.runIds[0])).toMatchObject({
      workflowId,
      connectionId: adminInbox.id,
      ownerScope: "member",
      enablementId: expect.any(String) as string,
    });
  });

  it("starts nothing for a member who switched it off", async () => {
    const { orgA, member, memberInbox, workflowId } = await bothEnabled();
    await disable(member.ctx, workflowId);

    const { runIds } = await startTriggeredRuns(
      systemCtx(orgA.id),
      arrived(orgA.id, memberInbox.id),
    );

    expect(runIds).toEqual([]);
  });

  it("starts nothing for a member who can no longer see the workflow", async () => {
    const { orgA, admin, member, memberInbox, salesTag } = await bothEnabled();
    // Before any cleanup removes the enablement.
    await unassignTag(admin.ctx, salesTag, member.id);

    const { runIds } = await startTriggeredRuns(
      systemCtx(orgA.id),
      arrived(orgA.id, memberInbox.id),
    );

    expect(runIds).toEqual([]);
  });

  it("skips a connection needing reauthorization, keeping its enablement, until reconnected", async () => {
    const { orgA, member, memberInbox, workflowId } = await bothEnabled();
    const system = systemCtx(orgA.id);
    await deliver(fakeNango.authWebhook(memberInbox.nangoConnectionId, "refresh", false));

    expect((await startTriggeredRuns(system, arrived(orgA.id, memberInbox.id))).runIds).toEqual([]);
    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch).toMatchObject({
      status: "on",
      needsReconnect: true,
    });

    const { token } = await startReconnect(member.ctx, memberInbox.id);
    await deliver(fakeNango.completeReconnect(token));

    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch?.needsReconnect).toBe(false);
    expect(
      (await startTriggeredRuns(system, arrived(orgA.id, memberInbox.id))).runIds,
    ).toHaveLength(1);
  });
});
