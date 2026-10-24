import { expect, test } from "./fixtures";

const adminScreens: [string, string, string][] = [
  ["/demo", "Dashboard", "Spend comparison"],
  ["/demo/teams", "Teams & Access", "Warpgate Labs"],
  ["/demo/agents", "Agents", "Company agent usage"],
  ["/demo/models", "Models & Providers", "Company model usage"],
  ["/demo/keys", "Bring your own key", "OpenAI"],
  ["/demo/routing", "Routing", "Company balanced"],
  ["/demo/logs", "Logs", "Request logs"],
  ["/demo/billing", "Billing", "Monthly bills"],
];

test("an admin opens every demo screen, each labeled as demo data", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  for (const [path, title, content] of adminScreens) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page.getByText(content).first()).toBeVisible();
    await expect(page.getByText(/Demo console with sample data/)).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Demo sections" }).getByRole("link", { name: title }),
    ).toHaveAttribute("aria-current", "page");
  }
});

test("a member can't open the demo's admin screens", async ({ page, orgs: { orgA }, signInAs }) => {
  await signInAs(orgA.member);
  await page.goto("/demo/logs");
  await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
  await expect(page.getByText("Request logs")).toHaveCount(0);
});

test("a member messages an agent and gets a simulated reply", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.member);
  await page.goto("/demo/messages?agent=research-analyst");
  const thread = page.getByRole("region", { name: "Conversation with Research Analyst" });
  await thread.getByRole("textbox", { name: "Message" }).fill("Research competitors every morning");
  await thread.getByRole("button", { name: "Send message" }).click();
  await expect(thread.getByText(/The demo doesn't run agents/)).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Agent activity" })).toBeVisible();
  await expect(page.getByText("Every day at 8:00 AM")).toBeVisible();
  await expect(thread.getByText(/tokens left today/)).toBeVisible();
});
