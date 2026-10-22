// The Workflows page lists every workflow with its enablements, its switch's connections and its
// review counts on each load, so it must make the same queries for 1 workflow as for 10.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, type FixtureOrg } from "@/db/testing/two-org-fixture";
import {
  enable,
  publishWorkflow,
  saveWorkflow,
  switchWorkflowOn,
} from "@/features/workflows/server";
import { connectMailbox } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import { adminWorkflows } from "../workflows/admin-workflows";

beforeEach(resetDatabase);

const labelSpec = (id: string, credentials: "member" | "org") => ({
  specVersion: 1,
  id,
  credentials,
  trigger: { type: "gmail.message_received" },
  steps: [
    {
      id: "label",
      type: "tool",
      action: "google-mail.add-label",
      input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
    },
  ],
  autonomy: { rung: 3 },
});

/**
 * Org A's workflows `from` to `to`: odd ones run on the org inbox and are switched on there,
 * even ones run on members' connections, published to `sales` and enabled by the member.
 */
async function addWorkflows(org: FixtureOrg, inboxId: string, from: number, to: number) {
  const admin = org.admin.ctx;
  for (let n = from; n <= to; n += 1) {
    const id = `labels-${String(n)}`;
    if (n % 2 === 1) {
      const saved = await saveWorkflow(admin, { name: id, spec: labelSpec(id, "org") });
      await publishWorkflow(admin, saved.id);
      await switchWorkflowOn(admin, saved.id, inboxId);
    } else {
      const { workflowId } = await publishTo(admin, id, labelSpec(id, "member"), ["sales"]);
      await enable(org.member.ctx, workflowId);
    }
  }
}

describe("the Workflows page's query budget", () => {
  it("makes the same queries for 1 workflow of each kind as for 5", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectMailbox(admin, orgA.admin.email);
    await connectMailbox(orgA.member.ctx, orgA.member.email);
    const inbox = await connectMailbox(admin, `support@${orgA.workspaceDomain}`, [], "org");
    await tagUsers(admin, "sales", [orgA.member]);
    await addWorkflows(orgA, inbox.id, 1, 2);

    const two = await countQueries(() => adminWorkflows(admin, "7d"));
    await addWorkflows(orgA, inbox.id, 3, 10);
    const ten = await countQueries(() => adminWorkflows(admin, "7d"));
    const page = await adminWorkflows(admin, "7d");

    expect(ten.queries).toBe(two.queries);
    expect(page.workflows).toHaveLength(10);
    // Each kind still gets its own: the member's enablement, the org inbox to switch on.
    const named = (name: string) => page.workflows.find((workflow) => workflow.name === name);
    expect(page.enablements.get(named("labels-2")?.id ?? "")).toEqual([
      expect.objectContaining({ userId: orgA.member.id }),
    ]);
    expect(page.orgConnections.get(named("labels-1")?.id ?? "")).toEqual([
      { id: inbox.id, label: `support@${orgA.workspaceDomain}` },
    ]);
  });
});
