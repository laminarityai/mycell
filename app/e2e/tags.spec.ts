import { expect, test } from "./fixtures";

test("an admin's new tag reaches the member they assign it to", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  await page.goto("/org");
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
  await page.goto("/org");
  const myTags = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Your tags" }),
  });
  await expect(myTags).toContainText("support-team");
});

test("a refused tag name stays in its field, and a rename closes once it's saved", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  await page.goto("/tags");
  const newName = page.getByRole("textbox", { name: "New tag name" });
  await newName.fill("Sales & Support");
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByText("Tag names use lowercase letters")).toBeVisible();
  await expect(newName).toHaveValue("Sales & Support");

  await newName.fill("sales");
  await page.getByRole("button", { name: "Add tag" }).click();
  const tag = page.getByRole("row").filter({ hasText: "sales" });
  await expect(tag).toBeVisible();
  await expect(newName).toHaveValue("");

  await tag.getByRole("button", { name: "Rename" }).click();
  // While it's renamed, the row's name is the field's value, so the row is found by the field.
  const rename = page.getByRole("textbox", { name: "New name for sales" });
  await rename.fill("Sales Team!");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Tag names use lowercase letters")).toBeVisible();
  await expect(rename).toHaveValue("Sales Team!");

  // The same name, written differently: a new one would announce the rename to Inngest, which
  // the e2e tests don't run.
  await rename.fill("Sales");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(rename).toBeHidden();
  await expect(tag).toBeVisible();
});
