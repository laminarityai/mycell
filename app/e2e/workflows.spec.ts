import type { Page } from "@playwright/test";
import { seedGoogleConnection } from "@/db/testing/seed-connection";
import type { FixtureUser } from "@/db/testing/two-org-fixture";
import { googleScope } from "@/lib/google";
import { expect, test } from "./fixtures";

// Complaints go to a person, pricing questions get a drafted reply, and the rest stops.
const TRIAGE = {
  specVersion: 2,
  id: "triage",
  credentials: "member",
  trigger: { type: "gmail.message_received", labelIds: ["INBOX"] },
  steps: [
    {
      id: "kind",
      type: "classify",
      role: "classify",
      question: "What kind of message is this?",
      labels: ["complaint", "pricing", "other"],
    },
    {
      id: "route",
      type: "branch",
      mode: "first",
      paths: [
        {
          id: "complaint",
          name: "Complaint",
          condition: {
            combine: "all",
            checks: [{ classify: "kind", is: "complaint", minP: 0.8 }],
          },
          steps: [{ id: "to-person", type: "escalate", reason: "A person handles complaints." }],
        },
        {
          id: "pricing",
          name: "Pricing",
          condition: {
            combine: "all",
            checks: [{ classify: "kind", is: "pricing", minP: 0.85 }],
          },
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
      ],
      otherwise: { id: "rest", steps: [] },
    },
  ],
  autonomy: { rung: 3 },
};

/** The triage spec with its classify question changed, and its pricing path renamed. */
function edited(question: string, pricingName = "Pricing"): object {
  return JSON.parse(
    JSON.stringify(TRIAGE)
      .replace(JSON.stringify(TRIAGE.steps[0]?.question), JSON.stringify(question))
      .replace('"name":"Pricing"', `"name":${JSON.stringify(pricingName)}`),
  ) as object;
}

async function withGmail(user: FixtureUser & { email: string }, orgId: string) {
  await seedGoogleConnection({
    orgId,
    ownerUserId: user.id,
    accountEmail: user.email,
    scopes: [googleScope("gmail.modify")],
  });
}

function jsonView(page: Page) {
  return page.getByRole("textbox", { name: "Spec (JSON)" });
}

function graph(page: Page) {
  return page.getByRole("region", { name: "Workflow graph" });
}

/** Writes `spec` in the JSON view and saves it. */
async function saveInJson(page: Page, spec: object) {
  await page.getByRole("tab", { name: "JSON" }).click();
  await jsonView(page).fill(JSON.stringify(spec));
  await expect(page.getByText("Ready to save.")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
}

test("an admin writes a branching workflow in the JSON view and sees its paths on the graph", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  await withGmail(orgA.admin, orgA.id);
  await signInAs(orgA.admin);
  await page.goto("/");
  await page.getByRole("link", { name: "Workflows" }).click();
  await page.getByRole("link", { name: "New workflow" }).click();
  await expect(page).toHaveURL("/workflows/new");
  await page.getByRole("textbox", { name: "Name" }).fill("Triage");
  await expect(page.getByText("No steps yet.")).toBeVisible();
  await page.getByRole("tab", { name: "JSON" }).click();

  // Unparsable JSON can't be drawn, or saved.
  await jsonView(page).fill('{"steps": [');
  await page.getByRole("tab", { name: "Graph" }).click();
  await expect(page.getByText("The graph can't show this yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  // An invalid spec shows its issues and can't be saved.
  await jsonView(page).fill(JSON.stringify({ ...TRIAGE, autonomy: { rung: 2 } }));
  await expect(page.getByRole("list", { name: "Issues with the spec" })).toContainText(
    "autonomy.rung",
  );
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  await saveInJson(page, TRIAGE);
  await expect(page.getByRole("heading", { name: "Workflow", exact: true })).toBeVisible();

  // The saved workflow's paths, left to right, each with its condition in plain words.
  const paths = graph(page).getByRole("group", { name: /^Path / });
  await expect(paths).toHaveText([
    /Complaint.*"kind" says "complaint" with at least 80% confidence/,
    /Pricing.*"kind" says "pricing" with at least 85% confidence/,
    /Otherwise.*no other path applies/,
  ]);
  await expect(graph(page).getByRole("group", { name: "Step reply" })).toContainText(
    "External send",
  );
  await expect(graph(page).getByRole("group", { name: "Step reply-approval" })).toContainText(
    "Waits for review (required by policy)",
  );
  await expect(graph(page).getByText("Stops here")).toBeVisible();

  // An edit in the JSON view shows on the graph, saves, and comes back as written.
  const renamed = edited("What is this message about?", "Prices");
  await page.getByRole("tab", { name: "JSON" }).click();
  await expect(jsonView(page)).toHaveValue(/"name": "Pricing"/);
  await jsonView(page).fill(JSON.stringify(renamed));
  await page.getByRole("tab", { name: "Graph" }).click();
  await expect(graph(page).getByRole("group", { name: "Path Prices" })).toBeVisible();
  await expect(page.getByText("Ready to save.")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("All changes saved.")).toBeVisible();

  await page.reload();
  await expect(graph(page).getByRole("group", { name: "Path Prices" })).toBeVisible();
  await expect(graph(page).getByRole("group", { name: "Step kind" })).toContainText(
    "What is this message about?",
  );
  await page.getByRole("tab", { name: "JSON" }).click();
  expect(JSON.parse(await jsonView(page).inputValue())).toEqual(renamed);
});

test("saving over a newer working spec is refused, and members can't reach the editor", async ({
  page,
  context,
  orgs: { orgA },
  signInAs,
}) => {
  await withGmail(orgA.admin, orgA.id);
  await signInAs(orgA.admin);
  await page.goto("/workflows/new");
  await page.getByRole("textbox", { name: "Name" }).fill("Triage");
  await saveInJson(page, TRIAGE);
  await expect(page.getByRole("heading", { name: "Workflow", exact: true })).toBeVisible();
  const workflowUrl = page.url();

  // A second tab saves first.
  const other = await context.newPage();
  await other.goto(workflowUrl);
  await saveInJson(other, edited("Saved first?"));
  await expect(other.getByText("All changes saved.")).toBeVisible();
  // Its next save is over the revision it just made, without a reload.
  await saveInJson(other, edited("Saved first!"));
  await expect(other.getByText("All changes saved.")).toBeVisible();

  await saveInJson(page, edited("Saved second?"));
  await expect(page.getByText("The working spec was saved again")).toBeVisible();
  await page.reload();
  await expect(graph(page).getByRole("group", { name: "Step kind" })).toContainText("Saved first!");

  await context.clearCookies();
  await signInAs(orgA.member);
  await page.goto(workflowUrl);
  await expect(page).toHaveURL("/");
  await page.goto("/workflows/new");
  await expect(page).toHaveURL("/");
});
