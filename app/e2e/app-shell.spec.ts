import { expect, test } from "./fixtures";

test("the sidebar marks the page it's on, and shows the Company group to admins only", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  const nav = page.getByRole("navigation", { name: "Main" });
  const company = nav.getByRole("group", { name: "Company" });

  await signInAs(orgA.member);
  await page.goto("/memory/access-log");
  await expect(nav.getByRole("link", { name: "Memory log" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.getByRole("link", { name: "Workflows" })).not.toHaveAttribute("aria-current");
  await expect(page.getByText("Member", { exact: true })).toBeVisible();
  await expect(company).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Memory settings" })).toHaveCount(0);

  await page.context().clearCookies();
  await signInAs(orgA.admin);
  await page.goto("/tags");
  await expect(company.getByRole("link", { name: "Manage tags" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(company.getByRole("link", { name: "Builder chat" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Memory settings" })).toBeVisible();
  await expect(page.getByText("Admin", { exact: true })).toBeVisible();
});

test("on a narrow screen the sidebar opens from the menu button", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signInAs(orgA.member);
  await page.goto("/reviews");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(page.getByRole("heading", { name: "Reviews", level: 1 })).toBeVisible();
  await expect(nav).toBeHidden();

  await page.getByRole("button", { name: "Menu" }).click();
  await nav.getByRole("link", { name: "Connections" }).click();
  await expect(page.getByRole("heading", { name: "Connections", level: 1 })).toBeVisible();
  // Following a link closes the menu again.
  await expect(nav).toBeHidden();
});

test("an unknown address shows the not-found page without signing in", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
  await expect(page).toHaveURL("/no-such-page");
});
