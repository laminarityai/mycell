import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { seedRun } from "@/db/testing/seed-run";
import { publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import { googleScope } from "@/lib/google";
import { expect, test } from "./fixtures";

// A member-credential workflow that reads the message it was started by.
const READ_SPEC = {
  specVersion: 2,
  id: "pricing-reads",
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  steps: [
    {
      id: "read",
      type: "tool",
      action: "google-mail.read-message",
      input: { messageId: { from: "trigger.messageId" } },
    },
  ],
  autonomy: { rung: 3 },
};

test("an admin opens Runs, sees a colleague's runs without their mail, and filters to failed", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  const gmail = [googleScope("gmail.modify")];
  // The admin publishes the workflow, which needs a Gmail connection of their own.
  await seedGoogleConnection({
    orgId: orgA.id,
    ownerUserId: orgA.admin.id,
    accountEmail: orgA.admin.email,
    scopes: gmail,
  });
  const { id: workflowId } = await saveWorkflow(orgA.admin.ctx, {
    name: "Pricing reads",
    spec: READ_SPEC,
  });
  const version = await publishWorkflow(orgA.admin.ctx, workflowId);
  // Two runs on the member's own Gmail: one succeeded, then one failed reading its message.
  // The admin isn't their reader, so the page fetches nothing from Gmail.
  const { id: connectionId } = await seedGoogleConnection({
    orgId: orgA.id,
    ownerUserId: orgA.member.id,
    accountEmail: orgA.member.email,
    scopes: gmail,
  });
  const run = { orgId: orgA.id, connectionId, ownerScope: "member" as const, workflowId };
  await seedRun({
    ...run,
    workflowVersionId: version.id,
    sourceRef: "message-1",
    status: "succeeded",
  });
  await seedRun({
    ...run,
    workflowVersionId: version.id,
    sourceRef: "message-2",
    status: "failed",
    failed: {
      stepId: "read",
      type: "tool",
      errorCode: "source_item_missing",
      errorMessage: "Gmail has no such item.",
    },
  });
  await signInAs(orgA.admin);

  await page.goto("/reviews");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Runs" }).click();
  await expect(page.getByRole("heading", { name: "Runs", level: 1 })).toBeVisible();
  const rows = page.getByRole("table", { name: "Runs" }).getByRole("row");
  // The header row and both runs, each with its message hidden.
  await expect(rows).toHaveCount(3);
  await expect(page.getByText(`Message hidden: ${orgA.member.email}'s inbox`)).toHaveCount(2);

  await page.getByLabel("Status").selectOption({ label: "Failed" });
  await page.getByRole("button", { name: "Filter" }).click();

  await expect(page).toHaveURL(/[?&]status=failed/);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Failed");
  await expect(rows.nth(1)).toContainText("Gmail has no such item.");
  await expect(page.getByLabel("Status")).toHaveValue("failed");
});
