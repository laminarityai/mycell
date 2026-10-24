import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { googleScope } from "@/lib/google";
import { expect, test } from "./fixtures";

// One classify step on new mail: nothing in it is Gmail's alone, so it can move to new invites.
const SORTING = {
  specVersion: 2,
  id: "sorting",
  credentials: "member",
  trigger: { type: "gmail.message_received", labelIds: ["INBOX"] },
  steps: [
    {
      id: "kind",
      type: "classify",
      role: "classify",
      question: "Is this about a sale?",
      labels: ["yes", "no"],
    },
  ],
  autonomy: { rung: 3 },
};

test("an admin moves a workflow onto new invites, and the editor says what that needs", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  // Allowed Gmail, not Calendar.
  await seedGoogleConnection({
    orgId: orgA.id,
    ownerUserId: orgA.admin.id,
    accountEmail: orgA.admin.email,
    scopes: [googleScope("gmail.modify")],
  });
  await signInAs(orgA.admin);
  await page.goto("/workflows/new");
  await page.getByRole("textbox", { name: "Name" }).fill("Sorting");
  await page.getByRole("tab", { name: "JSON" }).click();
  await page.getByRole("textbox", { name: "Spec (JSON)" }).fill(JSON.stringify(SORTING));
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Workflow", exact: true })).toBeVisible();
  const graph = page.getByRole("region", { name: "Workflow graph" });
  await expect(graph.getByRole("group", { name: "Trigger" })).toContainText(
    "When a message arrives in Gmail",
  );

  const settings = page.getByRole("region", { name: "Settings" });
  await settings
    .getByRole("combobox", { name: "Trigger" })
    .selectOption({ label: "When a new invite lands on the calendar" });

  await expect(graph.getByRole("group", { name: "Trigger" })).toContainText(
    "When a new invite lands on the calendar",
  );
  await expect(settings.getByRole("textbox", { name: /Gmail messages/ })).toBeHidden();
  // The connection checks run on the server, so saving is where the editor says what's missing.
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/allowed Calendar/).first()).toBeVisible();

  // An invite has no message to reply to or hand over.
  await graph.getByRole("button", { name: "Add a step after kind" }).click();
  const menu = graph.getByRole("menu", { name: "Add a step" });
  await expect(menu.getByRole("menuitem", { name: /Extract/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Draft a reply/ })).toBeHidden();
  await expect(menu.getByRole("menuitem", { name: /Hand to a person/ })).toBeHidden();
});
