import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedV1Workflow } from "@/db/testing/seed-workflow";
import { seedTwoOrgs, type FixtureOrg } from "@/db/testing/two-org-fixture";
import { GOOGLE_APP_SCOPES } from "@/features/connections/types";
import { specV1Schema } from "@/features/spec/v1";
import { createTag } from "@/features/tags/server";
import { publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import { connectGmail, connectOrgInbox } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { getConversation, startConversation, streamTurn } from "../server";
import { draftSpec, labelSpec, triageSpec } from "./specs";
import { fundOrg, readTurn } from "./turn-helpers";

beforeEach(resetDatabase);

// An org's setup, named after the org so a test can tell whose reached the model.
async function seedSetup(org: FixtureOrg, letter: string) {
  const admin = org.admin.ctx;
  await connectGmail(admin, org.admin.email);
  // The org inbox granted Gmail only.
  await connectOrgInbox(admin, `support@${org.workspaceDomain}`, [GOOGLE_APP_SCOPES.gmail]);
  await connectGmail(org.member.ctx, org.member.email);
  const published = await saveWorkflow(admin, {
    name: `${letter} pricing labels`,
    spec: labelSpec({ id: `${letter.toLowerCase()}-pricing` }),
  });
  await publishWorkflow(admin, published.id);
  const working = await saveWorkflow(admin, {
    name: `${letter} invoice labels`,
    spec: labelSpec({ id: `${letter.toLowerCase()}-invoices` }),
  });
  await createTag(admin, `${letter.toLowerCase()}-sales-team`);
  return { workingId: working.id };
}

async function instructionsOfTurn(org: FixtureOrg, workflowId?: string): Promise<string> {
  await fundOrg(org.id);
  const { id } = await startConversation(org.admin.ctx, { workflowId });
  fakeAiGateway.reply({ text: "Hello." });
  await readTurn(await streamTurn(org.admin.ctx, id, "What can you do?"));
  const request = fakeAiGateway.requests("language").at(-1);
  return JSON.stringify(request?.body);
}

describe("a turn's context", () => {
  it("sends the catalog, the org's workflows, connections and tags, and no other org's", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    await seedSetup(orgA, "A");
    await seedSetup(orgB, "B");

    const request = await instructionsOfTurn(orgA);

    // The catalog: each action with its app, risk level and pending form.
    expect(request).toContain("google-mail.create-draft");
    expect(request).toContain("google-sheet.append-row");
    expect(request).toContain("external_send");
    expect(request).toContain("waits as a Gmail draft");
    // The org's workflows, published or not.
    expect(request).toContain("A pricing labels");
    expect(request).toContain("A invoice labels");
    // The admin's own and the org's connections, with their apps; member connections as a count.
    expect(request).toContain("admin@org-a.test");
    expect(request).toContain("support@org-a.test");
    expect(request).toContain("1 member connection");
    expect(request).not.toContain("member@org-a.test");
    expect(request).toContain("a-sales-team");
    expect(request).toContain("Org A");
    expect(request).toContain("org-a.test");
    for (const otherOrg of ["B pricing", "B invoice", "org-b.test", "b-sales-team", "Org B"]) {
      expect(request).not.toContain(otherOrg);
    }
  });

  it("sends the working spec of the workflow the conversation is about", async () => {
    const { orgA } = await seedTwoOrgs();
    const { workingId } = await seedSetup(orgA, "A");

    const request = await instructionsOfTurn(orgA, workingId);

    expect(request).toContain("a-invoices");
    expect(request).toContain("Is this a pricing inquiry?");
  });
});

/** Text as it reads inside the request's JSON, its quotes and newlines escaped. */
const inJson = (text: string) => JSON.stringify(text).slice(1, -1);

describe("what the agent is told about branches", () => {
  it("explains branches, paths, conditions, and proposing one change at a time", async () => {
    const { orgA } = await seedTwoOrgs();

    const request = await instructionsOfTurn(orgA);

    for (const words of [
      "specVersion 2",
      "otherwise path",
      "first match",
      "checked left to right",
      "never join",
      "at most 10 paths",
      "3 deep",
      "a whole first version",
      "one change per proposal",
    ]) {
      expect(request).toContain(words);
    }
  });

  it("lists the fields a condition may test, with the checks each type allows", async () => {
    const { orgA } = await seedTwoOrgs();

    const request = await instructionsOfTurn(orgA);

    expect(request).toContain("## Fields a condition may test");
    // A classify step's answer, and an extract step's fields by their declared type.
    expect(request).toContain(
      inJson('{ "classify": "<classify step id>", "is": "<label>", "minP": 0.85 }'),
    );
    expect(request).toContain(
      "string field (text): is, is_not, contains, does_not_contain, starts_with, ends_with, is_empty, is_not_empty",
    );
    expect(request).toContain(
      "number field: equals, does_not_equal, more_than, less_than, at_least, at_most, is_empty, is_not_empty",
    );
    expect(request).toContain("boolean field (yes/no): is_yes, is_no, is_empty, is_not_empty");
  });

  it("summarizes each workflow's branches and paths", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.admin.ctx, orgA.admin.email);
    await saveWorkflow(orgA.admin.ctx, { name: "Triage", spec: triageSpec() });

    const request = await instructionsOfTurn(orgA);

    expect(request).toContain(
      inJson(
        'route (branch, first match: path complaint "Complaint": to-person (escalate); ' +
          'path pricing "Pricing": pricing-label (tool google-mail.add-label); ' +
          'path big "Big order": big-label (tool google-mail.add-label); ' +
          "otherwise rest: stops)",
      ),
    );
  });

  it("reads a workflow saved before paths as v2, in the context and through get_workflow", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const admin = orgA.admin.ctx;
    const { workflowId } = await seedV1Workflow({
      orgId: orgA.id,
      createdBy: orgA.admin.id,
      name: "Pricing",
      workingSpec: specV1Schema.parse(draftSpec()),
    });
    const { id } = await startConversation(admin, { workflowId });
    fakeAiGateway.reply({ toolCalls: [{ name: "get_workflow", input: { workflowId } }] });
    fakeAiGateway.reply({ text: "It drafts replies." });

    await readTurn(await streamTurn(admin, id, "What does it do?"));

    const request = JSON.stringify(fakeAiGateway.requests("language").at(0)?.body);
    expect(request).toContain(inJson('"specVersion": 2'));
    expect(request).toContain(
      inJson('gate (branch, first match: path gate-yes "yes": reply (draft)'),
    );
    const tool = (await getConversation(admin, id)).messages
      .at(-1)
      ?.parts.find((part) => part.type === "tool");
    expect(tool).toMatchObject({
      output: { workingSpec: { specVersion: 2, steps: [{ id: "classify" }, { id: "gate" }] } },
    });
  });
});
