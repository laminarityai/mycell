import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { seedRun } from "@/db/testing/seed-run";
import type { FixtureOrg } from "@/db/testing/two-org-fixture";
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

/**
 * The admin's published read workflow, and two runs of it on the member's own Gmail: one
 * succeeded, then one failed reading its message. The admin isn't their reader, so the pages
 * fetch nothing from Gmail.
 */
async function memberRuns(org: FixtureOrg) {
  const gmail = [googleScope("gmail.modify")];
  // The admin publishes the workflow, which needs a Gmail connection of their own.
  await seedGoogleConnection({
    orgId: org.id,
    ownerUserId: org.admin.id,
    accountEmail: org.admin.email,
    scopes: gmail,
  });
  const { id: workflowId } = await saveWorkflow(org.admin.ctx, {
    name: "Pricing reads",
    spec: READ_SPEC,
  });
  const version = await publishWorkflow(org.admin.ctx, workflowId);
  const { id: connectionId } = await seedGoogleConnection({
    orgId: org.id,
    ownerUserId: org.member.id,
    accountEmail: org.member.email,
    scopes: gmail,
  });
  const run = {
    orgId: org.id,
    connectionId,
    ownerScope: "member" as const,
    workflowId,
    workflowVersionId: version.id,
  };
  await seedRun({
    ...run,
    sourceRef: "message-1",
    status: "succeeded",
  });
  const failed = await seedRun({
    ...run,
    sourceRef: "message-2",
    status: "failed",
    failed: {
      stepId: "read",
      type: "tool",
      errorCode: "source_item_missing",
      errorMessage: "Gmail has no such item.",
    },
  });
  return { run, failed };
}

test("an admin opens Runs, sees a colleague's runs without their mail, and filters to failed", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await memberRuns(orgA);
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

test("an admin opens a colleague's failed run from Runs and sees its steps, not its mail", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await memberRuns(orgA);
  await signInAs(orgA.admin);

  await page.goto("/runs?status=failed");
  await page
    .getByRole("table", { name: "Runs" })
    .getByRole("link", { name: `Message hidden: ${orgA.member.email}'s inbox` })
    .click();

  await expect(page).toHaveURL(/\/runs\/[^/?]+$/);
  await expect(page.getByRole("heading", { name: "Run", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pricing reads" })).toBeVisible();
  const summary = page.getByRole("region", { name: "Run" });
  await expect(summary).toContainText("Failed");
  await expect(summary).toContainText(`Hidden: ${orgA.member.email}'s inbox`);
  // Its steps in order, and the one it failed at opened beside the graph.
  const steps = page.getByRole("list", { name: "Steps in order" });
  await expect(steps.getByRole("button", { name: /read/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Workflow graph" })).toBeVisible();
  const panel = page.getByRole("complementary", { name: "Step read" });
  await expect(panel).toContainText("Failed");
  await expect(panel).toContainText("The item isn't in its app");
  await expect(panel).toContainText("What to do:");
  await expect(panel).toContainText("Output hidden");
  await expect(page.getByRole("region", { name: "Reviews" })).toContainText(
    "This run created no reviews.",
  );
});

// Retrying sends an Inngest event, which the e2e app has nowhere to send, so retrying itself is
// Vitest's (runtime/tests/retry-runs.test.ts); this checks what the pages show of retries.
test("an admin can't retry a colleague's failed run, and sees its retry marked", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  const { run, failed } = await memberRuns(orgA);
  const retry = await seedRun({
    ...run,
    sourceRef: "message-2",
    status: "succeeded",
    retryOfRunId: failed.id,
  });
  await signInAs(orgA.admin);

  await page.goto("/runs");
  const rows = page.getByRole("table", { name: "Runs" }).getByRole("row");
  await expect(rows.filter({ hasText: "A retry" })).toHaveCount(1);

  await page.goto(`/runs/${failed.id}`);
  const summary = page.getByRole("region", { name: "Run" });
  await expect(summary.getByRole("button", { name: "Retry" })).toBeDisabled();
  await expect(summary).toContainText(
    `Only ${orgA.member.email} can retry a run on their own inbox.`,
  );
  await summary.getByRole("link", { name: "The retry" }).click();

  await expect(page).toHaveURL(new RegExp(`/runs/${retry.id}$`));
  await expect(page.getByRole("region", { name: "Run" })).toContainText("Succeeded");
  await expect(
    page.getByRole("region", { name: "Run" }).getByRole("link", { name: "The run that failed" }),
  ).toHaveAttribute("href", `/runs/${failed.id}`);
});
