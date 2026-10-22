// The trigger's fan-out for an archived workflow (M5): archiving stops new runs for every
// enablement and for the org switch, and restoring starts them again.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import {
  archiveWorkflow,
  enable,
  restoreWorkflow,
  switchWorkflowOn,
} from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";
import type { GmailMessageReceived } from "@/lib/events";
import { connectGoogle } from "@/testing/connect-helpers";
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

// Org A: a member workflow the member and the admin have on, and an org workflow switched on
// for the shared support inbox, both published to `sales`.
async function switchedOnEverywhere() {
  const { orgA } = await seedTwoOrgs();
  const { admin, member } = orgA;
  const adminInbox = await connectGoogle(admin.ctx, admin.email);
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
  await enable(admin.ctx, own.workflowId);
  await switchWorkflowOn(admin.ctx, shared.workflowId, support.id);
  return {
    orgA,
    admin,
    inboxes: [adminInbox.id, memberInbox.id, support.id],
    workflowIds: [own.workflowId, shared.workflowId],
  };
}

let messages = 0;

// How many runs a message arriving now on each connection starts, as discovery announces it.
async function runsStarted(orgId: string, connectionIds: string[]): Promise<number> {
  let started = 0;
  for (const connectionId of connectionIds) {
    messages += 1;
    const event: GmailMessageReceived = {
      orgId,
      connectionId,
      sourceRef: `message-${String(messages)}`,
      occurredAt: new Date().toISOString(),
      labelIds: ["INBOX"],
    };
    started += (await startTriggeredRuns(systemCtx(orgId), event)).runIds.length;
  }
  return started;
}

describe("an archived workflow", () => {
  it("starts no runs for any enablement nor its org switch, until it's restored", async () => {
    const { orgA, admin, inboxes, workflowIds } = await switchedOnEverywhere();
    expect(await runsStarted(orgA.id, inboxes)).toBe(3);

    for (const workflowId of workflowIds) await archiveWorkflow(admin.ctx, workflowId);
    expect(await runsStarted(orgA.id, inboxes)).toBe(0);

    for (const workflowId of workflowIds) await restoreWorkflow(admin.ctx, workflowId);
    expect(await runsStarted(orgA.id, inboxes)).toBe(3);
  });
});
