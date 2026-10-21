import { beforeEach, describe, expect, it } from "vitest";
import { eachStep } from "@/features/spec/tree";
import { upgradeSpec } from "@/features/spec/upgrade";
import { specV1Schema } from "@/features/spec/v1";
import { validateSpec } from "@/features/spec/validate";
import { resetDatabase } from "@/db/testing/reset";
import { seedV1Proposal } from "@/db/testing/seed-proposal";
import { seedV1Workflow, storedWorkingSpec } from "@/db/testing/seed-workflow";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import {
  getWorkflow,
  getWorkflowVersion,
  publishWorkflow,
  saveWorkflow,
} from "@/features/workflows/server";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { connectGmail } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import {
  acceptProposal,
  getConversation,
  listProposals,
  rejectProposal,
  startConversation,
  streamTurn,
} from "../server";
import { proposeInTurn } from "./proposal-helpers";
import { draftSpec, labelSpec, triageSpec } from "./specs";
import { fundOrg, readTurn } from "./turn-helpers";

beforeEach(resetDatabase);

async function setUp() {
  const { orgA } = await seedTwoOrgs();
  await fundOrg(orgA.id);
  const admin = orgA.admin.ctx;
  await connectGmail(admin, orgA.admin.email);
  return { orgA, admin };
}

/** A published workflow, and a conversation about it with one proposal to change it. */
async function proposedChange() {
  const { orgA, admin } = await setUp();
  const { id: workflowId } = await saveWorkflow(admin, {
    name: "Pricing",
    spec: labelSpec({ id: "pricing-replies" }),
  });
  const version = await publishWorkflow(admin, workflowId);
  const { id: conversationId } = await startConversation(admin, { workflowId });
  await proposeInTurn(admin, conversationId, [draftSpec()]);
  const proposal = (await listProposals(admin, conversationId)).at(0);
  if (proposal === undefined) throw new Error("no proposal");
  return { orgA, admin, workflowId, version, conversationId, proposal };
}

describe("this suite's v1 fixtures", () => {
  it("each upgrade to a valid v2 spec with the same step IDs, and once is enough", () => {
    for (const raw of [draftSpec(), labelSpec()]) {
      const v1 = specV1Schema.parse(raw);
      const spec = upgradeSpec(v1);

      expect(validateSpec(spec)).toEqual({ ok: true, spec });
      expect(eachStep(spec).map(({ step }) => step.id)).toEqual(v1.steps.map((step) => step.id));
      expect(upgradeSpec(spec)).toEqual(spec);
    }
  });
});

describe("acceptProposal", () => {
  it("creates a new workflow, unpublished, and links the conversation to it", async () => {
    const { admin } = await setUp();
    const { id: conversationId } = await startConversation(admin, {});
    await proposeInTurn(admin, conversationId, [draftSpec()]);
    const proposal = (await listProposals(admin, conversationId)).at(0);

    const { workflowId } = await acceptProposal(admin, proposal?.id ?? "");

    const workflow = await getWorkflow(admin, workflowId);
    expect(workflow).toMatchObject({ name: "Pricing replies", versions: [] });
    expect(eachStep(workflow.workingSpec).map(({ step }) => step.id)).toEqual([
      "classify",
      "gate",
      "reply",
    ]);
    expect((await getConversation(admin, conversationId)).workflowId).toBe(workflowId);
    expect(await listProposals(admin, conversationId)).toEqual([
      expect.objectContaining({ status: "accepted", workflowId }),
    ]);
  });

  it("changes an existing workflow's working spec, not its published version", async () => {
    const { admin, workflowId, version, proposal, conversationId } = await proposedChange();
    const steps = proposal.groups.flatMap((group) => group.steps);
    expect(steps.find((step) => step.id === "label")).toMatchObject({ change: "removed" });

    await acceptProposal(admin, proposal.id);

    const workflow = await getWorkflow(admin, workflowId);
    expect(eachStep(workflow.workingSpec).map(({ step }) => step.id)).toEqual([
      "classify",
      "gate",
      "reply",
    ]);
    expect(workflow.unpublishedChanges).toBe(true);
    expect(workflow.versions.map((v) => v.id)).toEqual([version.id]);
    expect((await getWorkflowVersion(admin, version.id)).spec).toEqual(version.spec);
    expect((await listProposals(admin, conversationId)).at(0)?.status).toBe("accepted");
  });

  it("refuses a proposal made against an older working spec and marks it stale", async () => {
    const { admin, workflowId, proposal, conversationId } = await proposedChange();
    // An admin edits the working spec by hand after the proposal was made.
    await saveWorkflow(admin, {
      workflowId,
      name: "Pricing",
      spec: labelSpec({ id: "pricing-replies", autonomy: { rung: 0 } }),
    });
    const before = await getWorkflow(admin, workflowId);

    await expect(acceptProposal(admin, proposal.id)).rejects.toThrow(ConflictError);

    expect(await getWorkflow(admin, workflowId)).toEqual(before);
    expect((await listProposals(admin, conversationId)).at(0)?.status).toBe("stale");

    // The agent is told on the next turn.
    fakeAiGateway.reply({ text: "I'll propose it again." });
    await readTurn(await streamTurn(admin, conversationId, "Why didn't it save?"));
    const request = JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);
    expect(request).toContain(`${proposal.id} (stale`);
  });

  it("decides a proposal once", async () => {
    const { admin, proposal } = await proposedChange();
    await rejectProposal(admin, proposal.id);

    await expect(acceptProposal(admin, proposal.id)).rejects.toThrow(ConflictError);
  });
});

describe("a proposal stored before paths", () => {
  it("shows grouped by path, and is accepted as v2 with the same step IDs", async () => {
    const { orgA, admin } = await setUp();
    const base = specV1Schema.parse(labelSpec({ id: "pricing-replies" }));
    const { workflowId } = await seedV1Workflow({
      orgId: orgA.id,
      createdBy: orgA.admin.id,
      name: "Pricing",
      workingSpec: base,
    });
    const { id: conversationId } = await startConversation(admin, { workflowId });
    const { proposalId } = await seedV1Proposal({
      orgId: orgA.id,
      conversationId,
      workflowId,
      name: "Pricing",
      baseRevision: (await getWorkflow(admin, workflowId)).revision,
      baseSpec: base,
      spec: specV1Schema.parse(draftSpec()),
      maxRisk: "external_send",
    });

    const proposal = (await listProposals(admin, conversationId)).at(0);
    expect(proposal?.groups.map((group) => group.path?.name ?? null)).toEqual([
      null,
      "yes",
      "Otherwise",
    ]);

    await acceptProposal(admin, proposalId);

    expect(await storedWorkingSpec(workflowId)).toMatchObject({ specVersion: 2 });
    const workflow = await getWorkflow(admin, workflowId);
    expect(eachStep(workflow.workingSpec).map(({ step }) => step.id)).toEqual([
      "classify",
      "gate",
      "reply",
    ]);
    expect((await listProposals(admin, conversationId)).at(0)?.status).toBe("accepted");
  });
});

describe("a branching proposal", () => {
  it("made against an older working spec is refused and marked stale", async () => {
    const { admin } = await setUp();
    const { id: workflowId } = await saveWorkflow(admin, { name: "Triage", spec: triageSpec() });
    const { id: conversationId } = await startConversation(admin, { workflowId });
    const proposed = triageSpec() as { steps: Record<string, unknown>[] };
    const route = proposed.steps[2] as { paths: Record<string, unknown>[] };
    route.paths = route.paths.filter((path) => path.id !== "big");
    await proposeInTurn(admin, conversationId, [proposed]);
    const proposal = (await listProposals(admin, conversationId)).at(0);
    await saveWorkflow(admin, {
      workflowId,
      name: "Triage",
      spec: { ...triageSpec(), autonomy: { rung: 0 } },
    });
    const before = await getWorkflow(admin, workflowId);

    await expect(acceptProposal(admin, proposal?.id ?? "")).rejects.toThrow(ConflictError);

    expect(await getWorkflow(admin, workflowId)).toEqual(before);
    expect((await listProposals(admin, conversationId)).at(0)?.status).toBe("stale");
  });
});

describe("rejectProposal", () => {
  it("leaves the working spec alone", async () => {
    const { admin, workflowId, proposal, conversationId } = await proposedChange();
    const before = await getWorkflow(admin, workflowId);

    await rejectProposal(admin, proposal.id);

    expect(await getWorkflow(admin, workflowId)).toEqual(before);
    expect((await listProposals(admin, conversationId)).at(0)?.status).toBe("rejected");
  });
});

describe("members", () => {
  it("can't list, accept or reject proposals", async () => {
    const { orgA, proposal, conversationId } = await proposedChange();
    const member = orgA.member.ctx;

    await expect(listProposals(member, conversationId)).rejects.toThrow(ForbiddenError);
    await expect(acceptProposal(member, proposal.id)).rejects.toThrow(ForbiddenError);
    await expect(rejectProposal(member, proposal.id)).rejects.toThrow(ForbiddenError);
  });
});
