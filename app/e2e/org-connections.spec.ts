import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { expect, test } from "./fixtures";

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

test("the connections page lists the registered apps, and which the caller has connected", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await seedGoogleConnection({
    orgId: orgA.id,
    ownerUserId: orgA.member.id,
    accountEmail: orgA.member.email,
    source: "microsoft",
    scopes: ["openid", "User.Read", "Mail.ReadWrite"],
  });

  await signInAs(orgA.member);
  await page.goto("/connections");
  const apps = page.getByRole("table", { name: "Your apps" });
  await expect(apps.getByRole("row").filter({ hasText: "Microsoft 365" })).toContainText(
    orgA.member.email,
  );
  await expect(apps.getByRole("row").filter({ hasText: "Google" })).toContainText("Not connected");
  await expect(
    page.getByRole("button", { name: "Connect Microsoft 365", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect an org Microsoft 365 account" }),
  ).toBeHidden();

  await page.context().clearCookies();
  await signInAs(orgA.admin);
  await page.goto("/connections");
  const orgApps = page.getByRole("table", { name: "Org apps" });
  await expect(orgApps.getByRole("row").filter({ hasText: "Microsoft 365" })).toContainText(
    "Not connected",
  );
  await expect(
    page.getByRole("button", { name: "Connect an org Microsoft 365 account" }),
  ).toBeVisible();
});
