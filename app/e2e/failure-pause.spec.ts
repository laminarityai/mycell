import type { Page } from "@playwright/test";
import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { seedRunningRun } from "@/db/testing/seed-running-run";
import type { FixtureUser } from "@/db/testing/two-org-fixture";
import { failCrashedRun } from "@/features/runtime/server";
import { systemCtx } from "@/lib/ctx";
import { googleScope } from "@/lib/google";
import { expect, test } from "./fixtures";

// Labels pricing questions: one Gmail write, nothing a model drafts.
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
};

async function withGmail(user: FixtureUser & { email: string }, orgId: string) {
  return seedGoogleConnection({
    orgId,
    ownerUserId: user.id,
    accountEmail: user.email,
    scopes: [googleScope("gmail.modify")],
  });
}

/** Makes the tag `name` on the tags screen, gives it to `user`, and publishes `spec` to it. */
async function publishToTag(page: Page, spec: object, tag: string, user: FixtureUser) {
  await page.goto("/tags");
  await page.getByRole("textbox", { name: "New tag name" }).fill(tag);
  await page.getByRole("button", { name: "Add tag" }).click();
  const row = page.getByRole("row").filter({ hasText: tag });
  await row.getByRole("combobox", { name: "User to tag" }).selectOption(user.email);
  await row.getByRole("button", { name: "Add", exact: true }).click();
  await expect(row.getByRole("button", { name: `Remove tag from ${user.email}` })).toBeVisible();

  await page.goto("/workflows/new");
  await page.getByRole("textbox", { name: "Name" }).fill("Pricing labels");
  await page.getByRole("tab", { name: "JSON" }).click();
  await page.getByRole("textbox", { name: "Spec (JSON)" }).fill(JSON.stringify(spec));
  await expect(page.getByText("Ready to save.")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish version 1" });
  await dialog.getByRole("checkbox", { name: tag }).click();
  await dialog.getByRole("button", { name: "Publish version 1" }).click();
  await expect(page.getByText("Version 1 is the latest.")).toBeVisible();
}

test("three failed runs pause a workflow for its members until an admin resumes it", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await withGmail(orgA.admin, orgA.id);
  const memberInbox = await withGmail(orgA.member, orgA.id);
  await signInAs(orgA.admin);
  await publishToTag(page, LABELS, "sales", orgA.member);
  const workflowPage = page.url();
  const workflowId = new URL(workflowPage).pathname.split("/").at(-1) ?? "";

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/workflows");
  const card = page.getByRole("listitem").filter({ hasText: "Pricing labels" });
  await card.getByRole("switch", { name: "Pricing labels" }).click();
  await expect(card).toContainText("On for your Google account");

  // Three runs on the member's inbox end failed, as the run job ends one that crashed.
  const system = systemCtx(orgA.id);
  for (let n = 0; n < 3; n += 1) {
    const run = await seedRunningRun({
      orgId: orgA.id,
      workflowId,
      connectionId: memberInbox.id,
    });
    await failCrashedRun(system, run.id);
  }

  await page.reload();
  await expect(card).toContainText("Paused: failing, an admin will look at it");
  await expect(card).toContainText("Your switch stays on.");
  await expect(card.getByRole("switch", { name: "Pricing labels" })).toBeChecked();

  await page.context().clearCookies();
  await signInAs(orgA.admin);
  await page.goto(workflowPage);
  const health = page.getByRole("region", { name: "Health" });
  await expect(health).toContainText("Paused: failing");
  const runs = health.getByRole("table", { name: "Runs that paused it" }).getByRole("row");
  // A header and the three runs, each on the member's inbox, by name alone.
  await expect(runs).toHaveCount(4);
  await expect(runs.nth(1)).toContainText(`${orgA.member.email}'s inbox`);
  await expect(runs.nth(1)).toContainText("Something went wrong on our side.");
  await health.getByRole("button", { name: "Resume" }).click();
  await expect(health).toHaveCount(0);

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/workflows");
  await expect(card).toContainText("On for your Google account");
});
