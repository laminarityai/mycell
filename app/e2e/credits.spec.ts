import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { recordUsage } from "@/features/credits/server";
import { publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";
import { googleScope } from "@/lib/google";
import { expect, test } from "./fixtures";

// Labels pricing questions, under a monthly budget of 200 credits.
const LABELS = {
  specVersion: 2,
  id: "pricing-labels",
  credentials: "member",
  trigger: { type: "gmail.message_received", labelIds: ["INBOX"] },
  steps: [
    {
      id: "label",
      type: "tool",
      action: "google-mail.add-label",
      input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
    },
  ],
  autonomy: { rung: 3 },
  budget: { monthlyCredits: 200 },
};

test("an admin opens Credits and sees the balance and a workflow's spending", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  // The admin publishes the workflow, which needs a Gmail connection of their own.
  await seedGoogleConnection({
    orgId: orgA.id,
    ownerUserId: orgA.admin.id,
    accountEmail: orgA.admin.email,
    scopes: [googleScope("gmail.modify")],
  });
  const { id } = await saveWorkflow(orgA.admin.ctx, { name: "Pricing labels", spec: LABELS });
  await publishWorkflow(orgA.admin.ctx, id);
  // A run's model call, as the gateway client records it: 120 of the 1,000 credits granted.
  await recordUsage(systemCtx(orgA.id), {
    role: "classify",
    modelId: "typesafe-ai/jev-1.14.0",
    costUsd: 0.12,
    outcome: "succeeded",
    workflowId: id,
    runId: "run_1",
  });

  await signInAs(orgA.admin);
  await page.goto("/reviews");
  await expect(page.getByRole("link", { name: /880 credits/ })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Credits" })
    .click();

  await expect(page.getByRole("heading", { name: "Credits", level: 1 })).toBeVisible();
  await expect(page.getByRole("group", { name: "Summary" })).toContainText("Balance now 880");
  const workflows = page.getByRole("region", { name: "Workflows against their budgets" });
  await expect(workflows.getByRole("button", { name: /Pricing labels/ })).toContainText(
    "120 / 200",
  );
  await expect(page.getByRole("row").filter({ hasText: "Pricing labels" })).toContainText("−120");
});

test("an admin picks a range, which the address keeps through a reload", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await recordUsage(systemCtx(orgA.id), {
    role: "smart",
    modelId: "openai/x",
    costUsd: 0.04,
    outcome: "succeeded",
    purpose: "builder",
  });
  const today = new Date().toISOString().slice(0, 10);

  await signInAs(orgA.admin);
  await page.goto("/credits");
  const range = page.getByRole("navigation", { name: "Date range" });
  await expect(range.getByRole("link", { name: "This month" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await range.getByRole("link", { name: "Last 3 months" }).click();

  await expect(page).toHaveURL(/\/credits\?range=3m$/);
  await page.reload();
  await expect(range.getByRole("link", { name: "Last 3 months" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // The org's history starts today, so the range does too.
  await expect(page.getByRole("group", { name: "Summary" })).toContainText(
    "Spent in the last 3 months 40",
  );

  await range.getByRole("link", { name: "Custom" }).click();
  const custom = page.getByRole("form", { name: "Custom range" });
  await custom.getByLabel("From").fill(today);
  await custom.getByLabel("to", { exact: true }).fill(today);
  await custom.getByRole("button", { name: "Show" }).click();

  await expect(page).toHaveURL(`/credits?range=custom&from=${today}&to=${today}`);
  await page.reload();
  await expect(page.getByRole("group", { name: "Summary" })).toContainText(
    "Spent in this range 40",
  );
  await expect(page.getByRole("heading", { name: /^Entries, / })).toBeVisible();
});

test("a member never sees Credits, and is sent away from its page", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.member);
  await page.goto("/credits");

  await expect(page).toHaveURL("/reviews");
  await expect(page.getByRole("link", { name: "Credits" })).toHaveCount(0);
  // The sidebar's foot shows a member no balance.
  await expect(page.getByRole("link", { name: /credits/ })).toHaveCount(0);
});
