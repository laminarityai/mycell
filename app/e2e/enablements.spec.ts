import type { Page } from "@playwright/test";
import { seedGoogleConnection } from "@/db/testing/seed-connection";
import type { FixtureUser } from "@/db/testing/two-org-fixture";
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
  await seedGoogleConnection({
    orgId,
    ownerUserId: user.id,
    accountEmail: user.email,
    scopes: [googleScope("gmail.modify")],
  });
}

/** Makes the tag `name` on the tags screen and gives it to `user`. */
async function makeTag(page: Page, name: string, user: FixtureUser) {
  await page.goto("/tags");
  await page.getByRole("textbox", { name: "New tag name" }).fill(name);
  await page.getByRole("button", { name: "Add tag" }).click();
  const tag = page.getByRole("row").filter({ hasText: name });
  await tag.getByRole("combobox", { name: "User to tag" }).selectOption(user.email);
  await tag.getByRole("button", { name: "Add", exact: true }).click();
  await expect(tag.getByRole("button", { name: `Remove tag from ${user.email}` })).toBeVisible();
}

/** Saves `spec` as a new workflow called `name` and publishes it to the tag `tag`. */
async function publishTo(page: Page, name: string, spec: object, tag: string) {
  await page.goto("/workflows/new");
  await page.getByRole("textbox", { name: "Name" }).fill(name);
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

test("a member sees a workflow published to their tag and switches it on", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await withGmail(orgA.admin, orgA.id);
  await withGmail(orgA.member, orgA.id);
  await signInAs(orgA.admin);
  await makeTag(page, "sales", orgA.member);
  await publishTo(page, "Pricing labels", LABELS, "sales");

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/workflows");
  const card = page.getByRole("listitem").filter({ hasText: "Pricing labels" });
  await expect(card).toContainText("Off");
  await card.getByRole("switch", { name: "Pricing labels" }).click();

  await expect(card).toContainText("On for your Google account");
  await expect(card.getByRole("switch", { name: "Pricing labels" })).toBeChecked();
  await page.reload();
  await expect(card).toContainText("On for your Google account");

  await page.context().clearCookies();
  await signInAs(orgA.admin);
  await page.goto("/workflows");
  const row = page.getByRole("row").filter({ hasText: "Pricing labels" });
  await expect(row).toContainText(orgA.member.email);
});

// LABELS, then a reply drafted for a person to send: an external send, so riskier.
const LABELS_AND_REPLIES = {
  ...LABELS,
  visibility: { tags: ["sales"] },
  steps: [
    ...LABELS.steps,
    {
      id: "reply",
      type: "draft",
      role: "smart",
      instructions: "Reply with our current prices.",
      context: ["trigger.message"],
      output: "google-mail.create-draft",
    },
  ],
};

test("a riskier version pauses a member's switch until they re-enable it", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await withGmail(orgA.admin, orgA.id);
  await withGmail(orgA.member, orgA.id);
  await signInAs(orgA.admin);
  await makeTag(page, "sales", orgA.member);
  await publishTo(page, "Pricing labels", LABELS, "sales");
  const workflowPage = page.url();

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/workflows");
  const card = page.getByRole("listitem").filter({ hasText: "Pricing labels" });
  await card.getByRole("switch", { name: "Pricing labels" }).click();
  await expect(card).toContainText("On for your Google account");

  // The admin adds a drafted reply; the publish dialog warns before it pauses anyone.
  await page.context().clearCookies();
  await signInAs(orgA.admin);
  await page.goto(workflowPage);
  await page.getByRole("tab", { name: "JSON" }).click();
  await page.getByRole("textbox", { name: "Spec (JSON)" }).fill(JSON.stringify(LABELS_AND_REPLIES));
  await expect(page.getByText("Ready to save.")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("All changes saved.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish version 2" });
  const warning = dialog.getByRole("note", { name: "What publishing pauses" });
  await expect(warning).toContainText(
    "Its risk level went up from Internal, reversible to External send.",
  );
  await expect(warning).toContainText("Publishing pauses it for 1 person");
  await dialog.getByRole("button", { name: "Publish version 2" }).click();
  await expect(page.getByText("Version 2 is the latest.")).toBeVisible();

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/workflows");
  await expect(card).toContainText("Paused: needs your OK for a riskier version");
  await expect(card.getByRole("group", { name: "What changed" })).toContainText(
    "Its risk level went up from Internal, reversible to External send.",
  );
  await card.getByRole("button", { name: "Re-enable" }).click();

  await expect(card).toContainText("On for your Google account");
  await expect(card.getByRole("switch", { name: "Pricing labels" })).toBeChecked();
});

test("archiving hides a workflow from members, and restoring brings back their switch", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await withGmail(orgA.admin, orgA.id);
  await withGmail(orgA.member, orgA.id);
  await signInAs(orgA.admin);
  await makeTag(page, "sales", orgA.member);
  await publishTo(page, "Pricing labels", LABELS, "sales");
  const workflowPage = page.url();

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/workflows");
  const card = page.getByRole("listitem").filter({ hasText: "Pricing labels" });
  await card.getByRole("switch", { name: "Pricing labels" }).click();
  await expect(card).toContainText("On for your Google account");

  await page.context().clearCookies();
  await signInAs(orgA.admin);
  await page.goto(workflowPage);
  const archive = page.getByRole("region", { name: "Archive" });
  await archive.getByRole("button", { name: "Archive" }).click();
  await expect(archive).toContainText("Archived since");
  await page.goto("/workflows");
  await expect(page.getByRole("row").filter({ hasText: "Pricing labels" })).toContainText(
    "Archived",
  );

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/workflows");
  await expect(page.getByText("Pricing labels")).toHaveCount(0);

  await page.context().clearCookies();
  await signInAs(orgA.admin);
  await page.goto(workflowPage);
  await archive.getByRole("button", { name: "Restore" }).click();
  await expect(archive.getByRole("button", { name: "Archive" })).toBeVisible();

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/workflows");
  await expect(card).toContainText("On for your Google account");
});
