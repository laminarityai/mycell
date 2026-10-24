import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { expect, test } from "./fixtures";

// A zero balance: every workflow is paused, and admins are told on every page.
test.describe("out of credits", () => {
  test.use({ credits: 0 });

  test("an admin sees the alert count and the banner on every page, until credits are granted", async ({
    page,
    orgs: { orgA },
    signInAs,
  }) => {
    await signInAs(orgA.admin);
    const nav = page.getByRole("navigation", { name: "Main" });
    const banner = page.getByRole("alert").filter({ hasText: "out of credits" });

    await page.goto("/workflows");
    await expect(banner).toContainText("Your company is out of credits.");
    await nav.getByRole("link", { name: "Alerts 1 open" }).click();

    await expect(page.getByRole("heading", { name: "Alerts", level: 1 })).toBeVisible();
    await expect(banner).toBeVisible();
    await expect(
      page.getByText("1 open alert, stopping everything. They clear by themselves once fixed."),
    ).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Out of credits" });
    await expect(row).toContainText("Once credits are granted.");
    await row.getByRole("link", { name: "See credits" }).click();
    await expect(page.getByRole("heading", { name: "Credits", level: 1 })).toBeVisible();

    // Nothing is stored: a grant clears the alert and the banner on the next page load.
    await grantCredits(systemCtx(orgA.id), 1000, "October allowance");
    await nav.getByRole("link", { name: "Alerts" }).click();
    await expect(page.getByText("Nothing needs you.")).toBeVisible();
    await expect(banner).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Alerts", exact: true })).toBeVisible();
  });

  test("a member sees no count, page or banner", async ({ page, orgs: { orgA }, signInAs }) => {
    await signInAs(orgA.member);

    await page.goto("/alerts");

    await expect(page).toHaveURL("/reviews");
    await expect(page.getByRole("heading", { name: "Reviews", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Alerts/ })).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: "out of credits" })).toHaveCount(0);
  });
});
