import { expect, test } from "./fixtures";

// e2e can't connect Gmail (no fake Nango in the production build), so this covers what an admin
// sees when a spec is refused; saving and publishing are covered by Vitest.
test("an admin sees every issue with a refused spec, and members can't reach workflows", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await signInAs(orgA.admin);
  await page.goto("/");
  await page.getByRole("link", { name: "Workflows" }).click();
  await page.getByRole("link", { name: "New workflow" }).click();
  await expect(page).toHaveURL("/workflows/new");

  await page.getByRole("textbox", { name: "Name" }).fill("Labels");
  const spec = page.getByRole("textbox", { name: "Spec (JSON)" });
  await spec.fill(
    JSON.stringify({
      specVersion: 1,
      id: "Not A Slug",
      credentials: "member",
      trigger: { type: "gmail.message_received" },
      steps: [{ id: "stop", type: "escalate", reason: "Always" }],
      autonomy: { rung: 2 },
    }),
  );
  await page.getByRole("button", { name: "Save" }).click();
  const problems = page.getByRole("alert").filter({ hasText: "The spec has" });
  await expect(problems).toContainText("The spec has 2 issues.");
  await expect(problems).toContainText("autonomy.rung");

  await spec.fill(
    JSON.stringify({
      specVersion: 1,
      id: "labels",
      credentials: "member",
      trigger: { type: "gmail.message_received" },
      steps: [{ id: "stop", type: "escalate", reason: "Always" }],
      autonomy: { rung: 0 },
    }),
  );
  await page.getByRole("button", { name: "Save" }).click();
  await expect(problems).toContainText("needs your own Google connection, allowed Gmail");
  await expect(spec).toHaveValue(/"id":"labels"/);

  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/workflows");
  await expect(page).toHaveURL("/");
});
