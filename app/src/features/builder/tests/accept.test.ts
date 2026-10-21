import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
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
import { draftSpec, labelSpec } from "./specs";
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

describe("acceptProposal", () => {
  it("creates a new workflow, unpublished, and links the conversation to it", async () => {
    const { admin } = await setUp();
    const { id: conversationId } = await startConversation(admin, {});
    await proposeInTurn(admin, conversationId, [draftSpec()]);
    const proposal = (await listProposals(admin, conversationId)).at(0);

    const { workflowId } = await acceptProposal(admin, proposal?.id ?? "");

    const workflow = await getWorkflow(admin, workflowId);
    expect(workflow).toMatchObject({ name: "Pricing replies", versions: [] });
    expect(workflow.workingSpec.steps.map((step) => step.id)).toEqual([
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
    expect(proposal.steps.find((step) => step.id === "label")).toMatchObject({ change: "removed" });

    await acceptProposal(admin, proposal.id);

    const workflow = await getWorkflow(admin, workflowId);
    expect(workflow.workingSpec.steps.map((step) => step.id)).toEqual([
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
