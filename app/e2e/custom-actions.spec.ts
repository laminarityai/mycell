import { readOutlookMessage, storeCustomAction } from "@/db/testing/custom-actions";
import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { saveWorkflow } from "@/features/workflows/server";
import { googleScope } from "@/lib/google";
import { expect, test } from "./fixtures";

test("admins see their company's custom actions and the workflows that use them", async ({
  page,
  orgs: { orgA, orgB },
  signInAs,
}) => {
  const admin = orgA.admin;
  // Save-time validation reads the admin's own Gmail and Microsoft 365 connections.
  for (const source of ["google", "microsoft"] as const) {
    await seedGoogleConnection({
      orgId: orgA.id,
      ownerUserId: admin.id,
      accountEmail: admin.email,
      source,
      scopes: source === "google" ? [googleScope("gmail.modify")] : [],
    });
  }
  await storeCustomAction(admin.ctx, readOutlookMessage());
  await saveWorkflow(admin.ctx, {
    name: "Outlook check",
    spec: {
      specVersion: 1,
      id: "outlook-check",
      credentials: "member",
      trigger: { type: "gmail.message_received" },
      steps: [
        {
          id: "outlook",
          type: "tool",
          action: "microsoft.read-message",
          input: { messageId: "AAMk-1" },
        },
      ],
      autonomy: { rung: 3 },
    },
  });
  // Org B's own action, which org A never sees.
  await storeCustomAction(
    orgB.admin.ctx,
    readOutlookMessage({ name: "microsoft.read-mail", description: "Org B's own Outlook read." }),
  );

  await signInAs(admin);
  await page.goto("/workflows");
  await page.getByRole("link", { name: "Custom actions" }).click();

  await expect(page).toHaveURL("/custom-actions");
  const actions = page.getByRole("list", { name: "Custom actions" }).getByRole("listitem");
  await expect(actions).toHaveCount(1);
  const action = actions.first();
  await expect(action).toContainText("Microsoft 365");
  await expect(action).toContainText("microsoft.read-message");
  await expect(action).toContainText(
    "Read one Outlook message: its subject, sender and whether it was read.",
  );
  await expect(action).toContainText("Calls GET /v1.0/me/messages/{messageId}");
  await expect(action).toContainText("Read");
  await expect(action).toContainText(`Accepted by ${admin.email} on`);
  await expect(action.getByRole("list", { name: "Workflows using it" })).toContainText(
    "Outlook check in the working spec, not yet published",
  );
  await expect(page.getByText("Org B's own Outlook read.")).toBeHidden();

  // Members have no such page.
  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/workflows");
  await expect(page.getByRole("link", { name: "Workflows" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Custom actions" })).toBeHidden();
  await page.goto("/custom-actions");
  await expect(page).toHaveURL("/reviews");
});
