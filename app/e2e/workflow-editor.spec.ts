import { expect, test } from "./fixtures";

// The editor's own behaviour, past what workflows.spec.ts covers: where its live check runs, and
// its add-step menu by keyboard.

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
