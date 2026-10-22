import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { GOOGLE_APP_SCOPES } from "@/features/connections/types";
import { expect, test } from "./fixtures";

test("a connection whose backfill failed offers its owner a reconnect", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await seedGoogleConnection({
    orgId: orgA.id,
    ownerUserId: orgA.member.id,
    accountEmail: orgA.member.email,
    scopes: Object.values(GOOGLE_APP_SCOPES),
    ingest: { gmail: "failed", drive: "active" },
  });

  await signInAs(orgA.member);
  await page.goto("/connections");
  await expect(page.getByText("Backfill failed")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    `Mycel couldn't finish reading ${orgA.member.email}'s history. Reconnect it to try again.`,
  );
  await expect(page.getByRole("button", { name: "Reconnect to retry" })).toBeVisible();
});

test("everyone can connect Google, and only admins an org Google account", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  await page.goto("/connections");
  await expect(page.getByRole("button", { name: "Connect Google", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect an org Google account" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Members' connections" })).toBeVisible();

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/connections");
  await expect(page.getByRole("button", { name: "Connect Google", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect an org Google account" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Org connections" })).toBeHidden();
});
