import { expect, test } from "./fixtures";

// Starting memory, excluding and forgetting a person send Inngest events, which the e2e app has
// nowhere to send, so those are Vitest's (memory/tests/budget.test.ts, exclusions.test.ts,
// forgetting.test.ts); this checks the page.
test("an admin sees memory's settings before starting it; members have no memory page", async ({
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
  await expect(page.getByTestId("memory-retention")).toContainText("for 24 months");
  await expect(page.getByRole("button", { name: "Forget this person" })).toBeVisible();

  // An admin marks a list company-wide, and takes the mark off.
  const list = `all@${orgA.workspaceDomain}`;
  await page.getByRole("textbox", { name: "Group address" }).fill(list);
  await page.getByRole("button", { name: "Mark company-wide" }).click();
  await expect(page.getByRole("cell", { name: list })).toBeVisible();
  await page.getByRole("button", { name: `Stop treating ${list} as company-wide` }).click();
  await expect(page.getByText("No lists are marked company-wide.")).toBeVisible();

  await page.getByRole("link", { name: "See the access log and staff access" }).click();
  await expect(page).toHaveURL("/memory/access-log");

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/org");
  await expect(page.getByRole("link", { name: "Memory settings" })).toBeHidden();
  await page.goto("/memory");
  await expect(page).not.toHaveURL("/memory");
});
