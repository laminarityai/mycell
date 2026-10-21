import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, type FixtureOrg } from "@/db/testing/two-org-fixture";
import { GOOGLE_APP_SCOPES } from "@/features/connections/types";
import { createTag } from "@/features/tags/server";
import { publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import { connectGmail, connectOrgInbox } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { startConversation, streamTurn } from "../server";
import { labelSpec } from "./specs";
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
