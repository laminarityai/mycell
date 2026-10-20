import { expect, test } from "./fixtures";

test("only admins get the controls to connect an org inbox or Drive", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  await page.goto("/connections");
  await expect(page.getByRole("button", { name: "Connect Gmail" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Google Drive" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect an org inbox" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect an org Drive" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Members' connections" })).toBeVisible();

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/connections");
  await expect(page.getByRole("button", { name: "Connect Gmail" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Google Drive" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect an org inbox" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Connect an org Drive" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Org connections" })).toBeHidden();
});
