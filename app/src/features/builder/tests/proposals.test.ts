import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { connectGmail } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { getConversation, listProposals, startConversation } from "../server";
import { proposeInTurn, SUMMARY } from "./proposal-helpers";
import { getWorkflow, saveWorkflow } from "@/features/workflows/server";
import type { Proposal } from "../types";
import { draftSpec, labelSpec, triageSpec } from "./specs";
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

/** Each group of the proposal's changes: its path's names, its words, and its steps' changes. */
function groupsOf(proposal: Proposal | undefined) {
  return (proposal?.groups ?? []).map((group) => [
    group.path === null ? null : [...group.path.within, group.path.name].join(" > "),
    group.path?.text ?? null,
    group.steps.map((step) => `${step.id} ${step.change}`),
  ]);
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

  it("shows the approval the policy engine inserted after a draft as waiting for review, on the draft's path", async () => {
    const { admin, conversationId } = await setUp();

    // A v1 spec, as a conversation from before paths may still hold.
    await proposeInTurn(admin, conversationId, [draftSpec()]);

    const proposal = (await listProposals(admin, conversationId)).at(0);
    expect(groupsOf(proposal)).toEqual([
      [null, null, ["classify added", "gate added"]],
      [
        "yes",
        'Runs when "classify" says "yes" with at least 85% confidence.',
        ["reply added", "reply-approval added"],
      ],
      ["Otherwise", "Runs when no other path applies, and stops the run.", []],
    ]);
    const steps = proposal?.groups.at(1)?.steps;
    expect(steps?.at(0)?.risk).toBe("external_send");
    expect(steps?.at(1)).toMatchObject({ waitsForReview: true, requiredByPolicy: true });
  });

  it("stores a branching proposal, and shows its steps grouped by path with each condition in words", async () => {
    const { admin, conversationId } = await setUp();

    await proposeInTurn(admin, conversationId, [triageSpec()]);

    const proposal = (await listProposals(admin, conversationId)).at(0);
    expect(proposal).toMatchObject({ status: "proposed", maxRisk: "internal_reversible" });
    expect(groupsOf(proposal)).toEqual([
      [null, null, ["kind added", "details added", "route added"]],
      [
        "Complaint",
        'Runs when "kind" says "complaint" with at least 80% confidence.',
        ["to-person added"],
      ],
      [
        "Pricing",
        'Runs when "kind" says "pricing" with at least 80% confidence.',
        ["pricing-label added"],
      ],
      [
        "Big order",
        'Runs when what they ask about contains "walnut" and the order total is more than 1000.',
        ["big-label added"],
      ],
      ["Otherwise", "Runs when no other path applies, and stops the run.", []],
    ]);
    expect(proposal?.groups.slice(1).map((group) => group.path?.change)).toEqual(
      Array.from({ length: 4 }, () => "added"),
    );
  });

  it("lists only what a proposal changes, by path, with a changed path's words before", async () => {
    const { admin, conversationId } = await setUp();
    const { id: workflowId } = await saveWorkflow(admin, { name: "Triage", spec: triageSpec() });
    const proposed = triageSpec() as { steps: Record<string, unknown>[] };
    const route = proposed.steps[2] as { paths: Record<string, unknown>[] };
    route.paths = route.paths.map((path) =>
      path.id === "complaint"
        ? {
            ...path,
            name: "Complaints",
            condition: {
              combine: "all",
              checks: [{ classify: "kind", is: "complaint", minP: 0.9 }],
            },
          }
        : path.id === "big"
          ? { ...path, steps: [] }
          : path,
    );

    await proposeInTurn(admin, conversationId, [proposed], { workflowId });

    const proposal = (await listProposals(admin, conversationId)).at(0);
    expect(groupsOf(proposal)).toEqual([
      ["Complaints", 'Runs when "kind" says "complaint" with at least 90% confidence.', []],
      [
        "Big order",
        'Runs when what they ask about contains "walnut" and the order total is more than 1000.',
        ["big-label removed"],
      ],
    ]);
    expect(proposal?.groups.at(0)?.path).toMatchObject({
      change: "changed",
      before: {
        name: "Complaint",
        text: 'Runs when "kind" says "complaint" with at least 80% confidence.',
      },
    });
    expect(proposal?.groups.at(1)?.path).toMatchObject({ change: "unchanged", before: null });
  });

  it("carries the spec it was made against and the spec it proposes, in the v2 shape, for the graph", async () => {
    const { admin, conversationId } = await setUp();
    const { id: workflowId } = await saveWorkflow(admin, { name: "Triage", spec: triageSpec() });
    const proposed = triageSpec() as { steps: Record<string, unknown>[] };
    proposed.steps = proposed.steps.slice(0, 1);

    await proposeInTurn(admin, conversationId, [proposed], { workflowId });
    await proposeInTurn(admin, conversationId, [draftSpec()]);

    const proposals = await listProposals(admin, conversationId);
    const change = proposals.at(0);
    const created = proposals.at(1);
    expect(change?.baseSpec).toEqual((await getWorkflow(admin, workflowId)).workingSpec);
    expect(change?.spec).toMatchObject({ specVersion: 2, steps: [{ id: "kind" }] });
    expect(created?.baseSpec).toBeNull();
    // The v1 draft spec is stored, and shown, upgraded.
    expect(created?.spec.specVersion).toBe(2);
    expect(created?.spec.steps.map((step) => step.id)).toEqual(["classify", "gate"]);
  });
});
