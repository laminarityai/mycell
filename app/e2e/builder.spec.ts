import { expect, test } from "./fixtures";

// The e2e server has no fake AI Gateway, so this sends a turn with no credits: it reaches the
// streaming route and the chat page, and no model. Scripted replies are covered by Vitest.
test("an admin starts a conversation and sees why the builder can't answer, and members can't reach it", async ({
  page,
  request,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  await page.goto("/");
  await page.getByRole("link", { name: "Builder chat" }).click();
  await expect(page).toHaveURL("/builder");
  await expect(page.getByText("No conversations yet.")).toBeVisible();
  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page).toHaveURL(/\/builder\/[\w-]+$/);

  await page.getByRole("textbox", { name: "Message" }).fill("Draft replies to pricing questions");
  await page.getByRole("button", { name: "Send" }).click();
  const messages = page.getByRole("list", { name: "Messages" });
  await expect(messages).toContainText("Draft replies to pricing questions");
  await expect(messages.getByRole("status")).toHaveText("Your organization is out of credits.");

  // Both are stored: reloading shows them, and the list is titled by the first message.
  await page.reload();
  await expect(messages).toContainText("Draft replies to pricing questions");
  await expect(messages.getByRole("status")).toHaveText("Your organization is out of credits.");
  const conversationId = page.url().split("/").at(-1) ?? "";
  await expect(
    page.getByRole("link", { name: "Draft replies to pricing questions" }),
  ).toBeVisible();

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/builder");
  await expect(page).toHaveURL("/");
  await page.goto(`/builder/${conversationId}`);
  await expect(page).toHaveURL("/");
  const turn = await page.request.post("/api/builder/turn", {
    data: { conversationId, message: "Hello" },
  });
  expect(turn.status()).toBe(403);

  // Signed out, the route asks for a sign-in rather than streaming.
  const signedOut = await request.post("/api/builder/turn", {
    data: { conversationId, message: "Hello" },
  });
  expect(signedOut.status()).toBe(401);
});
