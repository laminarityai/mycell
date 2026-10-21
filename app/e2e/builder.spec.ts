import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { googleScope } from "@/lib/google";
import { expect, test } from "./fixtures";

const PRICING_REPLIES = {
  specVersion: 1,
  id: "pricing-replies",
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  steps: [
    {
      id: "classify",
      type: "classify",
      role: "classify",
      question: "Is this a pricing inquiry?",
      labels: ["yes", "no"],
    },
    {
      id: "gate",
      type: "branch",
      when: { step: "classify", label: "yes", minP: 0.85 },
      else: "stop",
    },
    {
      id: "reply",
      type: "draft",
      role: "smart",
      instructions: "Reply with our current prices.",
      context: ["trigger.message"],
      output: "google-mail.create-draft",
    },
  ],
  autonomy: { rung: 3 },
};

test("an admin accepts the builder's proposal and gets an unpublished workflow with its steps", async ({
  page,
  orgs: { orgA },
  signInAs,
  aiGateway,
}) => {
  await grantCredits(systemCtx(orgA.id), 1000);
  // The e2e server can't connect Google; the spec's validation needs the admin's Gmail.
  await seedGoogleConnection({
    orgId: orgA.id,
    ownerUserId: orgA.admin.id,
    accountEmail: orgA.admin.email,
    scopes: [googleScope("gmail.modify")],
  });
  await aiGateway.reply({
    toolCalls: [
      {
        name: "propose_spec",
        input: { spec: PRICING_REPLIES, summary: "Drafts replies to pricing questions." },
      },
    ],
  });
  await aiGateway.reply({ text: "Here's a workflow that drafts replies to pricing questions." });

  await signInAs(orgA.admin);
  await page.goto("/builder");
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("Draft replies to pricing questions");
  await page.getByRole("button", { name: "Send" }).click();

  const proposal = page.getByRole("article", { name: "Proposal: Pricing replies" });
  const steps = proposal.getByRole("list", { name: "Steps" }).getByRole("listitem");
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(0)).toContainText('Asks "Is this a pricing inquiry?"');
  await expect(steps.nth(3)).toContainText("Waits for review (required by policy)");
  await proposal.getByRole("button", { name: "Accept" }).click();

  await expect(proposal).toContainText("Accepted");
  await expect(proposal.getByRole("button", { name: "Accept" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
  await proposal.getByRole("link", { name: "Open the workflow" }).click();
  await expect(page).toHaveURL(/\/workflows\/[\w-]+$/);
  await expect(page.getByText("Not published yet.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Spec (JSON)" })).toHaveValue(/"id": "reply"/);
});

// Out of credits, a turn reaches the streaming route and the chat page, and no model.
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
