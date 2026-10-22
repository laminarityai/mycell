// Custom actions in workflows (ADR-0018): saving, publishing and M5's version rules treat them
// like catalog actions, and a custom action in a registered app other than Google needs a
// connection to that app of the kind the credentials name.
import { beforeEach, describe, expect, it } from "vitest";
import { readOutlookMessage, storeCustomAction } from "@/db/testing/custom-actions";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { ValidationError } from "@/lib/errors";
import { connectApp, connectGoogle } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import {
  enable,
  getVisibleWorkflow,
  getWorkflow,
  listEnablements,
  publishWorkflow,
  saveWorkflow,
} from "../server";
import { labelSpec } from "./specs";

beforeEach(resetDatabase);

const label = {
  id: "label",
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
};
const outlook = {
  id: "outlook",
  type: "tool",
  action: "microsoft.read-message",
  input: { messageId: "AAMk-1" },
};

const withSteps = (steps: unknown[]) => labelSpec({ steps, visibility: { tags: ["sales"] } });

// Org A's admin has Google and Microsoft 365, and the custom read; the member has `sales` and
// their own Google account, and has the label workflow published to `sales` switched on.
async function memberEnabled() {
  const { orgA } = await seedTwoOrgs();
  const { admin, member } = orgA;
  await connectGoogle(admin.ctx, admin.email);
  await connectApp(admin.ctx, "microsoft", admin.email);
  await storeCustomAction(admin.ctx, readOutlookMessage());
  await connectGoogle(member.ctx, member.email);
  await tagUsers(admin.ctx, "sales", [member]);
  const { workflowId } = await publishTo(admin.ctx, "Labels", withSteps([label]), ["sales"]);
  await enable(member.ctx, workflowId);
  return { orgA, admin, member, workflowId };
}

describe("a custom read in a workflow", () => {
  it("saves at the level the rule set, as a step in its app", async () => {
    const { admin } = await memberEnabled();

    const { id } = await saveWorkflow(admin.ctx, {
      name: "Outlook",
      spec: labelSpec({ id: "outlook", steps: [outlook] }),
    });

    expect((await getWorkflow(admin.ctx, id)).maxRisk).toBe("read");
  });

  it("isn't saved without a connection to its app", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGoogle(orgA.admin.ctx, orgA.admin.email);
    await storeCustomAction(orgA.admin.ctx, readOutlookMessage());

    await expect(
      saveWorkflow(orgA.admin.ctx, { name: "Outlook", spec: labelSpec({ steps: [outlook] }) }),
    ).rejects.toMatchObject({
      issues: [
        {
          path: ["credentials"],
          message:
            "This workflow uses Microsoft 365, so it needs your own Microsoft 365 connection. Connect Microsoft 365 first.",
        },
      ],
    });
  });

  it("pauses members' enablements when a new version starts using its app", async () => {
    const { admin, member, workflowId } = await memberEnabled();

    await saveWorkflow(admin.ctx, {
      workflowId,
      name: "Labels",
      spec: withSteps([outlook, label]),
    });
    await publishWorkflow(admin.ctx, workflowId);

    expect((await listEnablements(admin.ctx, workflowId)).map((one) => one.status)).toEqual([
      "paused",
    ]);
    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch).toMatchObject({
      status: "paused",
      pausedChange: { newApps: ["Microsoft 365"] },
    });
    // Enabling again needs the member's own Microsoft 365 first.
    await expect(enable(member.ctx, workflowId)).rejects.toThrow(ValidationError);
    await connectApp(member.ctx, "microsoft", member.email);
    expect(await enable(member.ctx, workflowId)).toEqual({ enabled: true });
  });
});
