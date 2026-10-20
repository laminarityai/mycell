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
