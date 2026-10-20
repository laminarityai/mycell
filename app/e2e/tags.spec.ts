import { expect, test } from "./fixtures";

test("an admin's new tag reaches the member they assign it to", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  await page.goto("/");
  await page.getByRole("link", { name: "Manage tags" }).click();
  await expect(page).toHaveURL("/tags");

  await page.getByRole("textbox", { name: "New tag name" }).fill("Support Team");
  await page.getByRole("button", { name: "Add tag" }).click();
  const tag = page.getByRole("row").filter({ hasText: "support-team" });
  await expect(tag).toBeVisible();

  await tag.getByRole("combobox", { name: "User to tag" }).selectOption(orgA.member.email);
  await tag.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    tag.getByRole("button", { name: `Remove tag from ${orgA.member.email}` }),
  ).toBeVisible();

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/");
  const myTags = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Your tags" }),
  });
  await expect(myTags).toContainText("support-team");
});
