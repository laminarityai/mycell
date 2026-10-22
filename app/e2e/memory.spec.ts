import { expect, test } from "./fixtures";

// Starting memory and excluding send Inngest events, which the e2e app has nowhere to send, so
// those are Vitest's (memory/tests/budget.test.ts, exclusions.test.ts); this checks the page.
test("an admin sees memory's estimate before starting it; members have no memory page", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  await page.goto("/org");
  await page.getByRole("link", { name: "Memory settings" }).click();
  await expect(page).toHaveURL("/memory");
  await expect(page.getByTestId("memory-estimate")).toContainText("hold 0 emails and doc versions");
  await expect(page.getByRole("spinbutton", { name: "Monthly budget (credits)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start memory" })).toBeVisible();
  await expect(page.getByText("Nothing is excluded.")).toBeVisible();

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/org");
  await expect(page.getByRole("link", { name: "Memory settings" })).toBeHidden();
  await page.goto("/memory");
  await expect(page).not.toHaveURL("/memory");
});
