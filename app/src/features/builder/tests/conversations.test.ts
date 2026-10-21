import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { setRole } from "@/features/orgs/server";
import { saveWorkflow } from "@/features/workflows/server";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { connectGmail } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { getConversation, listConversations, startConversation, streamTurn } from "../server";
import { labelSpec } from "./specs";
import { fundOrg, readTurn } from "./turn-helpers";

beforeEach(resetDatabase);

describe("builder conversations", () => {
  it("lets a second admin open and continue a conversation the first admin started", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const first = orgA.admin.ctx;
    await setRole(first, orgA.member.id, "admin");
    const second = { ...orgA.member.ctx, role: "admin" as const };
    await connectGmail(first, orgA.admin.email);
    const workflow = await saveWorkflow(first, { name: "Label pricing mail", spec: labelSpec() });
    const { id } = await startConversation(first, {});
    fakeAiGateway.reply({
      toolCalls: [{ name: "get_workflow", input: { workflowId: workflow.id } }],
    });
    fakeAiGateway.reply({ text: "It labels pricing questions." });
    await readTurn(await streamTurn(first, id, "What does my workflow do?"));

    expect(await listConversations(second)).toEqual([
      expect.objectContaining({ id, title: "What does my workflow do?", startedBy: first.userId }),
    ]);
    fakeAiGateway.reply({ text: "Done." });
    await readTurn(await streamTurn(second, id, "Make it label invoices too"));

    // The second turn's model saw the first turn: the question, the tool's result, the answer.
    const request = JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);
    expect(request).toContain("What does my workflow do?");
    expect(request).toContain("Label pricing mail");
    expect(request).toContain("It labels pricing questions.");
    const messages = (await getConversation(second, id)).messages;
    expect(messages.map((m) => [m.role, m.authorId])).toEqual([
      ["user", first.userId],
      ["assistant", null],
      ["user", second.userId],
      ["assistant", null],
    ]);
    expect(messages[1]?.parts).toEqual([
      expect.objectContaining({ type: "tool", toolName: "get_workflow", isError: false }),
      { type: "text", text: "It labels pricing questions." },
    ]);
  });

  it("reads a workflow's hand-edited working spec on the next turn", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);
    const workflow = await saveWorkflow(admin, { name: "Label", spec: labelSpec() });
    const { id } = await startConversation(admin, { workflowId: workflow.id });
    fakeAiGateway.reply({ text: "It labels pricing questions." });
    await readTurn(await streamTurn(admin, id, "What does it do?"));

    const spec = labelSpec();
    const steps = spec.steps as Record<string, unknown>[];
    steps[0] = { ...steps[0], question: "Is this about invoices?" };
    await saveWorkflow(admin, {
      workflowId: workflow.id,
      name: "Label",
      spec,
      baseRevision: workflow.revision,
    });
    fakeAiGateway.reply({
      toolCalls: [{ name: "get_workflow", input: { workflowId: workflow.id } }],
    });
    fakeAiGateway.reply({ text: "It now labels invoices." });
    await readTurn(await streamTurn(admin, id, "And now?"));

    const toolResult = JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);
    expect(toolResult).toContain("Is this about invoices?");
    expect(toolResult).not.toContain("Is this a pricing inquiry?");
  });

  it("can be about one of the org's workflows", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);
    const workflow = await saveWorkflow(admin, { name: "Label", spec: labelSpec() });

    const started = await startConversation(admin, { workflowId: workflow.id });

    expect((await getConversation(admin, started.id)).workflowId).toBe(workflow.id);
    await expect(startConversation(admin, { workflowId: "missing" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("refuses an empty message", async () => {
    const { orgA } = await seedTwoOrgs();
    const { id } = await startConversation(orgA.admin.ctx, {});

    await expect(streamTurn(orgA.admin.ctx, id, "  ")).rejects.toThrow(ValidationError);
  });

  it("refuses members everywhere", async () => {
    const { orgA } = await seedTwoOrgs();
    const { id } = await startConversation(orgA.admin.ctx, {});
    const member = orgA.member.ctx;

    await expect(startConversation(member, {})).rejects.toThrow(ForbiddenError);
    await expect(listConversations(member)).rejects.toThrow(ForbiddenError);
    await expect(getConversation(member, id)).rejects.toThrow(ForbiddenError);
    await expect(streamTurn(member, id, "Hello")).rejects.toThrow(ForbiddenError);
    expect((await getConversation(orgA.admin.ctx, id)).messages).toEqual([]);
  });
});
