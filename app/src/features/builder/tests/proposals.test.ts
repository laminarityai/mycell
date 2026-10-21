import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { connectGmail } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { getConversation, listProposals, startConversation } from "../server";
import { proposeInTurn, SUMMARY } from "./proposal-helpers";
import { draftSpec, labelSpec } from "./specs";
import { fundOrg } from "./turn-helpers";

beforeEach(resetDatabase);

async function setUp() {
  const { orgA } = await seedTwoOrgs();
  await fundOrg(orgA.id);
  const admin = orgA.admin.ctx;
  await connectGmail(admin, orgA.admin.email);
  const { id } = await startConversation(admin, {});
  return { admin, conversationId: id };
}

function languageRequest(index: number): string {
  return JSON.stringify(fakeAiGateway.requests("language").at(index)?.body);
}

describe("propose_spec", () => {
  it("returns an invalid proposal's issues to the model, and stores the repaired one", async () => {
    const { admin, conversationId } = await setUp();

    await proposeInTurn(admin, conversationId, [draftSpec({ autonomy: { rung: 2 } }), draftSpec()]);

    // The second model step saw the first proposal's issue.
    expect(languageRequest(1)).toContain("rung");
    expect(await listProposals(admin, conversationId)).toEqual([
      expect.objectContaining({
        status: "proposed",
        workflowId: null,
        summary: SUMMARY,
        name: "Pricing replies",
        maxRisk: "external_send",
      }),
    ]);
  });

  it("gives up after three invalid proposals in a turn, shows the admin why, and stores none", async () => {
    const { admin, conversationId } = await setUp();
    const invalid = draftSpec({ autonomy: { rung: 2 } });

    await proposeInTurn(admin, conversationId, [invalid, invalid, invalid]);

    expect(await listProposals(admin, conversationId)).toEqual([]);
    expect(languageRequest(3)).toContain("Stop proposing");
    const reply = (await getConversation(admin, conversationId)).messages.at(-1);
    const attempts = (reply?.parts ?? []).flatMap((part) =>
      part.type === "tool" ? [part.output] : [],
    );
    expect(attempts).toEqual([
      expect.objectContaining({ ok: false, gaveUp: false }),
      expect.objectContaining({ ok: false, gaveUp: false }),
      expect.objectContaining({
        ok: false,
        gaveUp: true,
        issues: [expect.objectContaining({ path: ["autonomy", "rung"] })],
      }),
    ]);
  });

  it("never stores a proposal that uses an action outside the catalog", async () => {
    const { admin, conversationId } = await setUp();
    const spec = labelSpec();
    (spec.steps as Record<string, unknown>[])[1] = {
      id: "label",
      type: "tool",
      action: "google-mail.send-message",
      input: {},
    };

    await proposeInTurn(admin, conversationId, [spec]);

    expect(languageRequest(1)).toContain("isn't a catalog action");
    expect(await listProposals(admin, conversationId)).toEqual([]);
  });

  it("shows the approval the policy engine inserted after a draft as waiting for review", async () => {
    const { admin, conversationId } = await setUp();

    await proposeInTurn(admin, conversationId, [draftSpec()]);

    const proposal = (await listProposals(admin, conversationId)).at(0);
    expect(proposal?.steps.map((step) => [step.id, step.change, step.risk])).toEqual([
      ["classify", "added", null],
      ["gate", "added", null],
      ["reply", "added", "external_send"],
      ["reply-approval", "added", null],
    ]);
    expect(proposal?.steps.at(-1)).toMatchObject({ waitsForReview: true, requiredByPolicy: true });
  });
});
