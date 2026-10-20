import { expect, test, userRow } from "./fixtures";

test("a visitor who isn't signed in lands on the sign-in page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByText("Sign in to Mycel")).toBeVisible();
  await expect(page.getByRole("button", { name: /google/i })).toBeVisible();
});

test("an admin sees the org's users and can promote and remove them", async ({
  page,
  orgs: { orgA, orgB },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  await page.goto("/");

  await expect(userRow(page, orgA.admin)).toContainText("Admin");
  await expect(userRow(page, orgA.member)).toContainText("Member");
  await expect(page.getByText(orgB.admin.email)).toBeHidden();

  const member = userRow(page, orgA.member);
  await member.getByRole("button", { name: "Make admin" }).click();
  await expect(member).toContainText("Admin");
  await expect(member.getByRole("button", { name: "Make member" })).toBeVisible();

  await member.getByRole("button", { name: "Remove" }).click();
  await member.getByRole("button", { name: "Confirm remove" }).click();
  await expect(member).toBeHidden();
  await page.reload();
  await expect(page.getByText(orgA.member.email)).toBeHidden();
  await expect(userRow(page, orgA.admin)).toBeVisible();
});

test("a member sees no admin controls and is sent away from the tags screen", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.member);
  await page.goto("/tags");

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Your org" })).toBeVisible();
  await expect(userRow(page, orgA.admin)).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage tags" })).toBeHidden();
  await expect(page.getByRole("button", { name: /make admin|make member|remove/i })).toHaveCount(0);
});
