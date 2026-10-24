import { expect, test } from "./fixtures";

// The e2e server has no injection screen (Model Armor's host is fixed), so memory tools say
// memory is unavailable here: the reply's citations are covered in Vitest
// (src/features/agent/tests/citations.test.ts), and this covers the page.
test("a member opens Ask Mycel, asks a question and sees the streamed answer, privately", async ({
  page,
  orgs: { orgA },
  signInAs,
  aiGateway,
}) => {
  await signInAs(orgA.member);
  await aiGateway.reply({ text: "Memory doesn't know who handles Acme's renewals." });

  await page.goto("/");
  await page.getByRole("link", { name: "Ask Mycel" }).click();
  await expect(page.getByText("Only you can see these.")).toBeVisible();
  await page.getByRole("button", { name: "New conversation" }).click();

  await expect(page.getByText("You're talking to Mycel, an AI.")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message to Mycel" })
    .fill("Who handles Acme's renewals?");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Memory doesn't know who handles Acme's renewals.")).toBeVisible();
  // The conversation is in the rail, titled by its question.
  const rail = page.getByRole("list", { name: "Conversations" });
  await expect(rail.getByText("Who handles Acme's renewals?")).toBeVisible();

  // Searching the rail finds it by a word of its messages, highlighted, and Escape clears it.
  const search = page.getByRole("searchbox", { name: "Search conversations" });
  await search.fill("renewals");
  await expect(page.getByText("1 conversation", { exact: true })).toBeVisible();
  await expect(rail.locator("mark", { hasText: "renewals" }).first()).toBeVisible();
  await search.fill("brightline");
  await expect(page.getByText("No conversations match")).toBeVisible();
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(page.getByText("No conversations match")).toBeHidden();
  await expect(rail.getByText("Who handles Acme's renewals?")).toBeVisible();
});
