import { expect, test, userRow } from "./fixtures";

test("a visitor who isn't signed in lands on the sign-in page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByText("Sign in to Mycel")).toBeVisible();
  await expect(page.getByRole("button", { name: /google/i })).toBeVisible();
});

test("an admin sees the org's users and can promote, remove and re-add them", async ({
  page,
  orgs: { orgA, orgB },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  await page.goto("/org");

  await expect(userRow(page, orgA.admin)).toContainText("Admin");
  await expect(userRow(page, orgA.member)).toContainText("Member");
  await expect(page.getByText(orgB.admin.email)).toBeHidden();

  const member = userRow(page, orgA.member);
  await member.getByRole("button", { name: "Make admin" }).click();
  await expect(member).toContainText("Admin");
  await expect(member.getByRole("button", { name: "Make member" })).toBeVisible();

  await member.getByRole("button", { name: "Remove" }).click();
  await member.getByRole("button", { name: "Confirm remove" }).click();
  // The member's one row now is under Removed people, where they can be re-added.
  const removed = page.getByRole("table", { name: "Removed people" });
  await expect(removed.getByRole("row").filter({ hasText: orgA.member.email })).toBeVisible();
  await expect(member).toHaveCount(1);
  await page.reload();
  await expect(member).toHaveCount(1);
  await expect(member.getByRole("button", { name: "Make admin" })).toBeHidden();
  // The admin is now also named under Removed people, as who removed the member.
  await expect(
    page
      .getByRole("table", { name: "People", exact: true })
      .getByRole("row")
      .filter({ hasText: orgA.admin.email }),
  ).toBeVisible();

  await member.getByRole("button", { name: "Re-add" }).click();
  await expect(page.getByText(orgA.member.email)).toBeHidden();
  await expect(removed).toBeHidden();
});

test("a member sees no admin controls and is sent away from the tags screen", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.member);
  await page.goto("/tags");

  await expect(page).toHaveURL("/reviews");
  await page.getByRole("link", { name: "Your org" }).click();
  await expect(page.getByRole("heading", { name: "Your org" })).toBeVisible();
  await expect(userRow(page, orgA.admin)).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage tags" })).toBeHidden();
  await expect(page.getByRole("button", { name: /make admin|make member|remove/i })).toHaveCount(0);
});
