import { expect, test } from "./fixtures";

const CODE_DRAFT = "const keep = await getContact(keepId);\nawait mergeInto(keep, mergeId);";

test("the builder files a capability request that only the company's admins see", async ({
  page,
  orgs: { orgA, orgB },
  signInAs,
  aiGateway,
}) => {
  await aiGateway.reply({
    toolCalls: [
      {
        name: "file_capability_request",
        input: {
          app: "microsoft",
          operation: "Merge two contacts",
          inputs: [{ name: "keepId", description: "The contact to keep" }],
          outputs: [],
          reason: "Merging reads both contacts and writes one: more than one call.",
          codeDraft: CODE_DRAFT,
        },
      },
    ],
  });
  await aiGateway.reply({ text: "I can't merge contacts yet, so I've asked Mycel's team." });

  await signInAs(orgA.admin);
  await page.goto("/builder");
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("Merge duplicate contacts");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("I can't merge contacts yet")).toBeVisible();
  await page.getByRole("link", { name: "Follow it on Capability requests" }).click();

  await expect(page).toHaveURL("/capability-requests");
  const request = page.getByRole("list", { name: "Capability requests" }).getByRole("listitem");
  await expect(request.first()).toContainText("Merge two contacts");
  await expect(request.first()).toContainText("Open");
  await expect(request.first()).toContainText("Microsoft 365 · Asked once");
  await page.getByText("Code draft").click();
  await expect(page.locator("pre")).toHaveText(CODE_DRAFT);
  await expect(page.getByRole("link", { name: "Merge duplicate contacts" })).toBeVisible();

  // Another company's admin sees none of it.
  await page.context().clearCookies();
  await signInAs(orgB.admin);
  await page.goto("/capability-requests");
  await expect(page.getByText("No capability requests yet.")).toBeVisible();

  // Members have no such page.
  await page.context().clearCookies();
  await signInAs(orgA.member);
  await page.goto("/workflows");
  await expect(page.getByRole("link", { name: "Workflows" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Capability requests" })).toBeHidden();
  await page.goto("/capability-requests");
  await expect(page).toHaveURL("/reviews");
});
