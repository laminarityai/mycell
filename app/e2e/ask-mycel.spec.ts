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
  await expect(
    page.getByRole("list", { name: "Conversations" }).getByText("Who handles Acme's renewals?"),
  ).toBeVisible();
});
