import { expect, test } from "./fixtures";

// The editor's own behaviour, past what workflows.spec.ts covers: where its live check runs, and
// its add-step menu and its boxes by keyboard.

test("the live check finds a spec's issues in the browser, with no Server Action", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  await page.goto("/workflows/new");
  await page.getByRole("tab", { name: "JSON" }).click();

  // A Server Action is a POST naming the action in its Next-Action header.
  let actionCalls = 0;
  page.on("request", (request) => {
    if ("next-action" in request.headers()) actionCalls += 1;
  });
  await page
    .getByRole("textbox", { name: "Spec (JSON)" })
    .fill(JSON.stringify({ specVersion: 2, steps: [] }));
  await expect(page.getByRole("list", { name: "Issues with the spec" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(actionCalls).toBe(0);
});

test("the add-step menu takes arrow keys, and hands focus back to its + when it closes", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  await page.goto("/workflows/new");
  const graph = page.getByRole("region", { name: "Workflow graph" });
  const plus = graph.getByRole("button", { name: "Add a step first" });
  await plus.click();

  const menu = graph.getByRole("menu", { name: "Add a step" });
  const items = menu.getByRole("menuitem");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(items.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(items.first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(plus).toBeFocused();

  // Enter on an item adds that step, and opens it in the side panel.
  await plus.press("Enter");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(graph.getByRole("complementary", { name: "Editor" })).toBeVisible();
});

// A classify step, then a branch whose one path hands complaints to a person: nothing the policy
// engine adds a review to.
const ROUTED = {
  specVersion: 2,
  id: "routed",
  credentials: "member",
  trigger: { type: "gmail.message_received", labelIds: ["INBOX"] },
  steps: [
    {
      id: "kind",
      type: "classify",
      role: "classify",
      question: "What kind of message is this?",
      labels: ["complaint", "other"],
    },
    {
      id: "route",
      type: "branch",
      mode: "first",
      paths: [
        {
          id: "complaint",
          name: "Complaint",
          condition: { combine: "all", checks: [{ classify: "kind", is: "complaint", minP: 0.8 }] },
          steps: [{ id: "to-person", type: "escalate", reason: "A person handles complaints." }],
        },
      ],
      otherwise: { id: "rest", steps: [] },
    },
  ],
  autonomy: { rung: 3 },
};

test("the graph's boxes take Tab in reading order, and Enter or Space opens one like a click", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  await page.goto("/workflows/new");
  await page.getByRole("tab", { name: "JSON" }).click();
  await page.getByRole("textbox", { name: "Spec (JSON)" }).fill(JSON.stringify(ROUTED));
  await page.getByRole("tab", { name: "Graph" }).click();
  const graph = page.getByRole("region", { name: "Workflow graph" });
  await expect(graph.getByRole("group", { name: "Step to-person", exact: true })).toBeVisible();

  // Tab from the Graph tab on through the graph, noting each box it stops on, until it leaves.
  const reached: string[] = [];
  for (let presses = 0; presses < 40; presses++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null) return { inGraph: false, box: null };
      const isBox = element.classList.contains("react-flow__node");
      return {
        inGraph: element.closest('[aria-label="Workflow graph"]') !== null,
        box: isBox ? element.getAttribute("aria-label") : null,
      };
    });
    if (focused.box !== null) reached.push(focused.box);
    if (!focused.inGraph && reached.length > 0) break;
  }
  // An end isn't a stop: there's nothing in it to open.
  expect(reached).toEqual([
    "Trigger",
    "Step kind",
    "Step route",
    "Path Complaint",
    "Step to-person",
    "Path Otherwise",
  ]);

  // Enter on a step opens it in the side panel, as a click does.
  const panel = graph.getByRole("complementary", { name: "Editor" });
  await graph.getByRole("button", { name: "Step kind", exact: true }).press("Enter");
  await expect(panel.getByRole("textbox", { name: "Question" })).toHaveValue(
    "What kind of message is this?",
  );

  // Space on a path opens that path instead.
  await graph.getByRole("button", { name: "Path Complaint", exact: true }).press("Space");
  await expect(panel.getByRole("textbox", { name: "Name" })).toHaveValue("Complaint");
});
