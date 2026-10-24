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
  await expect(page.getByRole("group", { name: "Summary" })).toContainText("Balance 880");
  const workflows = page.getByRole("region", { name: "Workflows against their budgets" });
  await expect(workflows.getByRole("button", { name: /Pricing labels/ })).toContainText(
    "120 / 200",
  );
  await expect(page.getByRole("row").filter({ hasText: "Pricing labels" })).toContainText("−120");
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
