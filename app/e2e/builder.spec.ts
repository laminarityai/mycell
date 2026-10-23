import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { googleScope } from "@/lib/google";
import type { Page } from "@playwright/test";
import type { FixtureUser, TwoOrgs } from "@/db/testing/two-org-fixture";
import type { E2eAiGateway } from "./fake-ai-gateway";
import { expect, test } from "./fixtures";

// Pricing questions get a drafted reply, complaints go to a person, and the rest stop.
const SORT_THE_INBOX = {
  specVersion: 2,
  id: "sort-the-inbox",
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  steps: [
    {
      id: "kind",
      type: "classify",
      role: "classify",
      question: "What is this email about?",
      labels: ["pricing", "complaint", "other"],
    },
    {
      id: "route",
      type: "branch",
      mode: "first",
      paths: [
        {
          id: "pricing",
          name: "Pricing",
          condition: { combine: "all", checks: [{ classify: "kind", is: "pricing", minP: 0.85 }] },
          steps: [
            {
              id: "reply",
              type: "draft",
              role: "smart",
              instructions: "Reply with our current prices.",
              context: ["trigger.message"],
              output: "google-mail.create-draft",
            },
          ],
        },
        {
          id: "complaint",
          name: "Complaint",
          condition: {
            combine: "all",
            checks: [{ classify: "kind", is: "complaint", minP: 0.7 }],
          },
          steps: [{ id: "hand-over", type: "escalate", reason: "A customer is unhappy." }],
        },
      ],
      otherwise: { id: "rest", steps: [] },
    },
  ],
  autonomy: { rung: 3 },
};

/** The builder answers the next message with a proposal of `SORT_THE_INBOX`. */
async function scriptProposal(aiGateway: E2eAiGateway) {
  await aiGateway.reply({
    toolCalls: [
      {
        name: "propose_spec",
        input: { spec: SORT_THE_INBOX, summary: "Sorts the inbox: prices, complaints, the rest." },
      },
    ],
  });
  await aiGateway.reply({ text: "Here's a workflow that sorts the inbox." });
}

/** Signs the admin in, with their own Gmail connection (the fixture funds the org). */
async function signInWithGmail(
  orgA: TwoOrgs["orgA"],
  signInAs: (user: FixtureUser) => Promise<void>,
) {
  // The e2e server can't connect Google; the spec's validation needs the admin's Gmail.
  await seedGoogleConnection({
    orgId: orgA.id,
    ownerUserId: orgA.admin.id,
    accountEmail: orgA.admin.email,
    scopes: [googleScope("gmail.modify")],
  });
  await signInAs(orgA.admin);
}

function graph(page: Page) {
  return page.getByRole("region", { name: "Workflow graph" });
}

test("an admin sees the builder's branching proposal on the graph beside the chat, and accepts it", async ({
  page,
  orgs: { orgA },
  signInAs,
  aiGateway,
}) => {
  await signInWithGmail(orgA, signInAs);
  await scriptProposal(aiGateway);
  await page.goto("/builder");
  await page.getByRole("button", { name: "New conversation" }).click();

  // Before any proposal, the graph holds only the trigger and the placeholder.
  await expect(graph(page).getByRole("group", { name: "Trigger" })).toBeVisible();
  await expect(graph(page)).toContainText("Your workflow will appear here");

  await page.getByRole("textbox", { name: "Message" }).fill("Sort my inbox");
  await page.getByRole("button", { name: "Send" }).click();

  const proposal = page.getByRole("article", { name: "Proposal: Sort the inbox" });
  // Grouped by path: the classify step and the branch, the pricing path's draft and its review,
  // and the complaint path's hand-over.
  const steps = proposal.getByRole("listitem");
  await expect(steps).toHaveCount(5);
  await expect(proposal.getByRole("region", { name: "Path Pricing" })).toContainText(
    'Runs when "kind" says "pricing" with at least 85% confidence.',
  );
  await expect(steps.nth(3)).toContainText("Waits for review (required by policy)");

  // The waiting proposal is drawn on the graph as new steps on its paths.
  await expect(page.getByText("Showing the proposal")).toBeVisible();
  await expect(graph(page)).not.toContainText("Your workflow will appear here");
  for (const name of ["Path Pricing", "Path Complaint", "Path Otherwise"]) {
    await expect(graph(page).getByRole("group", { name, exact: true })).toContainText("New");
  }
  await expect(graph(page).getByRole("group", { name: "Step reply", exact: true })).toContainText(
    "New",
  );
  await expect(graph(page).getByText("Stops here")).toBeVisible();
  // Nothing is edited on the graph while a proposal is drawn on it.
  await expect(graph(page).getByRole("button", { name: /^Add a step/ })).toHaveCount(0);

  // Hiding it shows the workflow as it is: nothing yet.
  await proposal.getByRole("button", { name: "Hide it on the graph" }).click();
  await expect(graph(page)).toContainText("Your workflow will appear here");
  await expect(graph(page).getByRole("group", { name: "Path Pricing" })).toBeHidden();
  await proposal.getByRole("button", { name: "Show it on the graph" }).click();
  await expect(graph(page).getByRole("group", { name: "Path Pricing" })).toBeVisible();

  await proposal.getByRole("button", { name: "Accept" }).click();

  // Accepted, the graph draws the working spec: the same paths, no longer marked new.
  await expect(proposal).toContainText("Accepted");
  await expect(proposal.getByRole("button", { name: "Accept" })).toBeHidden();
  await expect(page.getByText("Showing the proposal")).toBeHidden();
  await expect(graph(page).getByRole("group", { name: "Path Pricing" })).toBeVisible();
  await expect(graph(page).getByRole("group", { name: "Path Complaint" })).not.toContainText("New");
  await expect(
    graph(page).getByRole("group", { name: "Step reply-approval", exact: true }),
  ).toContainText("Waits for review (required by policy)");
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();

  // Beside the chat, the working spec is edited on its graph and saved there too.
  await graph(page).getByRole("group", { name: "Path Pricing" }).click();
  await graph(page)
    .getByRole("complementary", { name: "Editor" })
    .getByRole("textbox", { name: "Name" })
    .fill("Prices");
  await expect(graph(page).getByRole("group", { name: "Path Prices" })).toBeVisible();
  const saveBar = page.getByRole("form", { name: "Save the workflow" });
  await expect(saveBar).toContainText("Ready to save.");
  await saveBar.getByRole("button", { name: "Save" }).click();
  await expect(saveBar).toBeHidden();
  await page.reload();
  await expect(graph(page).getByRole("group", { name: "Path Prices" })).toBeVisible();

  await proposal.getByRole("link", { name: "Open the workflow" }).click();
  await expect(page).toHaveURL(/\/workflows\/[\w-]+$/);
  await expect(page.getByText("Not published yet.")).toBeVisible();
  await expect(graph(page).getByRole("group", { name: "Step reply-approval" })).toContainText(
    "Waits for review (required by policy)",
  );
  await page.getByRole("tab", { name: "JSON" }).click();
  await expect(page.getByRole("textbox", { name: "Spec (JSON)" })).toHaveValue(/"id": "reply"/);

  // The workflow's page lists its conversation, and starts another about it, open on its graph.
  const conversations = page.getByRole("region", { name: "Builder conversations" });
  await expect(conversations.getByRole("link", { name: "Sort my inbox" })).toBeVisible();
  await conversations.getByRole("button", { name: "New conversation" }).click();
  await expect(page).toHaveURL(/\/builder\/[\w-]+$/);
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
  await expect(graph(page).getByRole("group", { name: "Path Complaint" })).toBeVisible();
});

test("on a narrow screen, the chat and the graph are two tabs, and a proposal turns to the graph", async ({
  page,
  orgs: { orgA },
  signInAs,
  aiGateway,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInWithGmail(orgA, signInAs);
  await scriptProposal(aiGateway);
  await page.goto("/builder");
  await page.getByRole("button", { name: "New conversation" }).click();

  const chatTab = page.getByRole("tab", { name: "Chat" });
  const workflowTab = page.getByRole("tab", { name: "Workflow" });
  await expect(chatTab).toHaveAttribute("aria-selected", "true");
  await expect(graph(page)).toBeHidden();
  await workflowTab.click();
  await expect(graph(page)).toContainText("Your workflow will appear here");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeHidden();
  await chatTab.click();

  // The tabs take arrow keys, and the chat keeps what was typed while the graph is shown.
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Sort my inbox");
  await chatTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(workflowTab).toHaveAttribute("aria-selected", "true");
  await expect(message).toBeHidden();
  await page.keyboard.press("ArrowLeft");
  await expect(chatTab).toHaveAttribute("aria-selected", "true");
  await expect(message).toHaveValue("Sort my inbox");
  await page.getByRole("button", { name: "Send" }).click();

  // The proposal is shown on the graph, so the page turns to it.
  await expect(workflowTab).toHaveAttribute("aria-selected", "true");
  await expect(graph(page).getByRole("group", { name: "Path Pricing" })).toBeVisible();
  await chatTab.click();
  await expect(page.getByRole("article", { name: "Proposal: Sort the inbox" })).toBeVisible();
});

// Out of credits, a turn reaches the streaming route and the chat page, and no model.
test.describe("out of credits", () => {
  test.use({ credits: 0 });

  test("an admin starts a conversation and sees why the builder can't answer, and members can't reach it", async ({
    page,
    request,
    orgs: { orgA },
    signInAs,
  }) => {
    await signInAs(orgA.admin);
    await page.goto("/org");
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
    await expect(page).toHaveURL("/reviews");
    await page.goto(`/builder/${conversationId}`);
    await expect(page).toHaveURL("/reviews");
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
});
