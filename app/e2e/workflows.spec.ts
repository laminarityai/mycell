import type { Page } from "@playwright/test";
import { seedGoogleConnection } from "@/db/testing/seed-connection";
import type { FixtureUser } from "@/db/testing/two-org-fixture";
import { googleScope } from "@/lib/google";
import { expect, test } from "./fixtures";

const PRICING = {
  specVersion: 1,
  id: "pricing",
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  steps: [
    {
      id: "classify",
      type: "classify",
      role: "classify",
      question: "Is this a pricing inquiry?",
      labels: ["yes", "no"],
    },
    {
      id: "gate",
      type: "branch",
      when: { step: "classify", label: "yes", minP: 0.85 },
      else: "stop",
    },
    {
      id: "reply",
      type: "draft",
      role: "smart",
      instructions: "Reply with our current prices.",
      context: ["trigger.message"],
      output: "google-mail.create-draft",
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

function jsonView(page: Page) {
  return page.getByRole("textbox", { name: "Spec (JSON)" });
}

test("an admin writes a workflow in the JSON view, then edits it in the form", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await withGmail(orgA.admin, orgA.id);
  await signInAs(orgA.admin);
  await page.goto("/");
  await page.getByRole("link", { name: "Workflows" }).click();
  await page.getByRole("link", { name: "New workflow" }).click();
  await expect(page).toHaveURL("/workflows/new");
  await page.getByRole("textbox", { name: "Name" }).fill("Pricing replies");
  await page.getByRole("tab", { name: "JSON" }).click();

  // Unparsable JSON can't go back to the form, or be saved.
  await jsonView(page).fill('{"steps": [');
  await page.getByRole("tab", { name: "Form" }).click();
  await expect(page.getByText("The form can't show this yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  // An invalid spec shows its issues and can't be saved.
  await jsonView(page).fill(JSON.stringify({ ...PRICING, autonomy: { rung: 2 } }));
  const issues = page.getByRole("list", { name: "Issues with the spec" });
  await expect(issues).toContainText("autonomy.rung");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  // An edit in the JSON view shows in the form.
  await jsonView(page).fill(JSON.stringify(PRICING));
  await page.getByRole("tab", { name: "Form" }).click();
  const classify = page.getByRole("region", { name: "Step classify" });
  await expect(classify.getByRole("textbox", { name: "Question" })).toHaveValue(
    "Is this a pricing inquiry?",
  );
  // The policy's approval shows after the draft, and can't be removed.
  const inserted = page.getByRole("region", { name: "Step reply-approval" });
  await expect(inserted).toContainText("Waits for review (required by policy)");
  await expect(inserted.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await expect(page.getByText("Ready to save.")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Workflow", exact: true })).toBeVisible();

  // A classify step's question and threshold, changed in the form, show in the JSON view.
  await classify.getByRole("textbox", { name: "Question" }).fill("Is this about prices?");
  await classify.getByRole("spinbutton", { name: "Minimum confidence" }).fill("0.9");
  await page.getByRole("tab", { name: "JSON" }).click();
  await expect(jsonView(page)).toHaveValue(/"question": "Is this about prices\?"/);
  await expect(jsonView(page)).toHaveValue(/"minP": 0.9/);
  await page.getByRole("tab", { name: "Form" }).click();

  // An issue shows on the step it's about.
  const gate = page.getByRole("region", { name: "Step gate" });
  await gate.getByRole("combobox", { name: "When step" }).selectOption("classify");
  await classify.getByRole("textbox", { name: "Labels (comma-separated)" }).fill("pricing, other");
  await expect(gate.getByRole("list", { name: "Issues with step gate" })).toContainText(
    "when.label",
  );
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await gate.getByRole("combobox", { name: "Says" }).selectOption("pricing");
  await expect(page.getByText("Ready to save.")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("All changes saved.")).toBeVisible();

  await page.reload();
  await expect(classify.getByRole("textbox", { name: "Question" })).toHaveValue(
    "Is this about prices?",
  );
  await expect(classify.getByRole("spinbutton", { name: "Minimum confidence" })).toHaveValue("0.9");
});

test("saving over a newer working spec is refused, and members can't reach the editor", async ({
  page,
  context,
  orgs: { orgA },
  signInAs,
}) => {
  await withGmail(orgA.admin, orgA.id);
  await signInAs(orgA.admin);
  await page.goto("/workflows/new");
  await page.getByRole("textbox", { name: "Name" }).fill("Pricing replies");
  await page.getByRole("tab", { name: "JSON" }).click();
  await jsonView(page).fill(JSON.stringify(PRICING));
  await expect(page.getByText("Ready to save.")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Workflow", exact: true })).toBeVisible();
  const workflowUrl = page.url();

  // A second tab saves first.
  const other = await context.newPage();
  await other.goto(workflowUrl);
  const question = (tab: Page) =>
    tab.getByRole("region", { name: "Step classify" }).getByRole("textbox", { name: "Question" });
  await question(other).fill("Saved first?");
  await expect(other.getByText("Ready to save.")).toBeVisible();
  await other.getByRole("button", { name: "Save" }).click();
  await expect(other.getByText("All changes saved.")).toBeVisible();
  // Its next save is over the revision it just made, without a reload.
  await question(other).fill("Saved first!");
  await expect(other.getByText("Ready to save.")).toBeVisible();
  await other.getByRole("button", { name: "Save" }).click();
  await expect(other.getByText("All changes saved.")).toBeVisible();

  await question(page).fill("Saved second?");
  await expect(page.getByText("Ready to save.")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("The working spec was saved again")).toBeVisible();
  await page.reload();
  await expect(question(page)).toHaveValue("Saved first!");

  await context.clearCookies();
  await signInAs(orgA.member);
  await page.goto(workflowUrl);
  await expect(page).toHaveURL("/");
  await page.goto("/workflows/new");
  await expect(page).toHaveURL("/");
});
