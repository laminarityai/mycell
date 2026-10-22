import { expect, test } from "./fixtures";

test("an admin gives our staff consent for a case on the memory log, and revokes it", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  await page.goto("/org");
  await page.getByRole("link", { name: "Memory log" }).click();
  await expect(page).toHaveURL("/memory/access-log");
  await expect(page.getByText("No reads yet.")).toBeVisible();

  await page.getByRole("textbox", { name: "Mycel staff email" }).fill("sam@mycel.example");
  await page.getByRole("textbox", { name: "The case" }).fill("Ticket 4411");
  await page.getByRole("spinbutton", { name: "Days" }).fill("3");
  await page.getByRole("button", { name: "Give consent" }).click();
  const consent = page.getByRole("row").filter({ hasText: "Ticket 4411" });
  await expect(consent).toContainText("sam@mycel.example");
  await expect(consent).toContainText("Until");

  await consent.getByRole("button", { name: "Revoke" }).click();
  await expect(consent).toContainText("Revoked");
  await expect(consent.getByRole("button", { name: "Revoke" })).toHaveCount(0);

  // A member sees only their part of the log, and no staff consents.
  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/memory/access-log");
  await expect(page.getByText("No reads yet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Staff access" })).toHaveCount(0);
});
