import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { listRuns } from "@/features/runtime/server";
import { saveWorkflow } from "@/features/workflows/server";
import { ValidationError } from "@/lib/errors";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { getConversation, startConversation, streamTurn, tryInConversation } from "../server";
import { draftSpec, labelSpec, triageSpec } from "./specs";
import { fundOrg, readTurn } from "./turn-helpers";

beforeEach(resetDatabase);

const REPLY = "Thanks Ada, 30 oak chairs come to 2,400 GBP.";

const labelStep = {
  id: "label",
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
};

/** A workflow that classifies, branches, labels and drafts, and a conversation about it. */
async function setUp() {
  const { orgA } = await seedTwoOrgs();
  await fundOrg(orgA.id);
  const admin = orgA.admin.ctx;
  const google = await connectGoogle(admin, orgA.admin.email);
  const message = google.mailbox.add({
    from: "ada@customer.test",
    subject: "Quote for 30 oak chairs",
    text: "Hello, what would 30 oak chairs cost?",
    at: new Date(Date.now() - 60_000),
  });
  const spec = draftSpec();
  (spec.steps as unknown[]).splice(2, 0, labelStep);
  const { id: workflowId } = await saveWorkflow(admin, { name: "Pricing replies", spec });
  const { id: conversationId } = await startConversation(admin, { workflowId });
  return { admin, google, message, workflowId, conversationId };
}

describe("tryInConversation", () => {
  it("returns the draft's text, and posts only a content-free summary the agent reads next", async () => {
    const { admin, google, message, workflowId, conversationId } = await setUp();
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.93, no: 0.07 } });
    fakeAiGateway.text(REPLY, { costUsd: 0.01 });

    const { result } = await tryInConversation(admin, conversationId, {
      connectionId: google.id,
      sourceRef: message.id,
    });

    expect(result.steps.find((step) => step.stepId === "reply")?.effect).toMatchObject({
      kind: "draft",
      text: REPLY,
    });
    const { messages } = await getConversation(admin, conversationId);
    expect(messages).toHaveLength(1);
    const stored = JSON.stringify(messages);
    for (const content of [REPLY, "Quote for 30 oak chairs", "ada@customer.test", "oak chairs"]) {
      expect(stored).not.toContain(content);
    }
    const lines = messages
      .flatMap((m) => m.parts.flatMap((part) => (part.type === "try_it" ? part.lines : [])))
      .join("\n");
    for (const said of ['"yes"', "went on", 'the label "Pricing"', "drafted a reply", "review"]) {
      expect(lines).toContain(said);
    }
    expect(await listRuns(admin, workflowId)).toEqual([]);
    expect(google.mailbox.writes.log).toEqual([]);

    fakeAiGateway.reply({ text: "I'll make the draft less formal." });
    await readTurn(await streamTurn(admin, conversationId, "The draft was too formal"));
    const turn = JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);
    expect(turn).toContain("drafted a reply");
    expect(turn).not.toContain(REPLY);
  });

  it("names where a label comes from, never the value a reference resolved to", async () => {
    const { admin, google, message } = await setUp();
    const spec = labelSpec({
      steps: [
        {
          id: "details",
          type: "extract",
          role: "fast",
          fields: { city: { type: "string", description: "Where to deliver" } },
        },
        { ...labelStep, input: { ...labelStep.input, label: { from: "details.city" } } },
      ],
    });
    const { id: workflowId } = await saveWorkflow(admin, { name: "City labels", spec });
    const { id: conversationId } = await startConversation(admin, { workflowId });
    fakeAiGateway.object({ city: "Leeds" }, { costUsd: 0 });

    const { result } = await tryInConversation(admin, conversationId, {
      connectionId: google.id,
      sourceRef: message.id,
    });

    expect(result.steps.at(-1)?.effect).toEqual({ kind: "label", label: "Leeds" });
    const { messages } = await getConversation(admin, conversationId);
    expect(JSON.stringify(messages)).not.toContain("Leeds");
    const lines = messages.flatMap((m) =>
      m.parts.flatMap((part) => (part.type === "try_it" ? part.lines : [])),
    );
    expect(lines).toContain("label (tool): would add a label from details.city.");
  });

  it("names the paths and each check's result in the spec's words, never a value it tested", async () => {
    const { admin, google, message } = await setUp();
    const { id: workflowId } = await saveWorkflow(admin, { name: "Triage", spec: triageSpec() });
    const { id: conversationId } = await startConversation(admin, { workflowId });
    fakeAiGateway.decision({
      choice: "other",
      probabilities: { complaint: 0.05, pricing: 0.05, other: 0.9 },
    });
    fakeAiGateway.object({ product: "Walnut desks", total: 2750 });

    await tryInConversation(admin, conversationId, {
      connectionId: google.id,
      sourceRef: message.id,
    });

    const { messages } = await getConversation(admin, conversationId);
    const lines = messages.flatMap((m) =>
      m.parts.flatMap((part) => (part.type === "try_it" ? part.lines : [])),
    );
    expect(lines).toEqual(
      expect.arrayContaining([
        'route (branch): went on along "Big order".',
        'route, path "Complaint": didn\'t apply. "kind" says "complaint" with at least 80% confidence: failed.',
        'route, path "Big order": ran. details.product contains "walnut": passed; ' +
          "details.total is more than 1000: passed.",
      ]),
    );
    const stored = JSON.stringify(messages);
    for (const value of ["Walnut desks", "2750", "90% sure"]) expect(stored).not.toContain(value);
  });

  it("says when an every-match run partly failed, naming every path it went along", async () => {
    const { admin, google, message } = await setUp();
    const spec = triageSpec();
    const route = (spec.steps as Record<string, unknown>[])[2] as {
      mode: string;
      paths: { id: string; steps: unknown[] }[];
    };
    route.mode = "every";
    route.paths[1].steps = [
      {
        id: "prices",
        type: "tool",
        action: "google-sheet.read-range",
        input: { spreadsheetId: "no-such-sheet", range: "Prices!A1:C50" },
      },
    ];
    const { id: workflowId } = await saveWorkflow(admin, { name: "Triage", spec });
    const { id: conversationId } = await startConversation(admin, { workflowId });
    fakeAiGateway.decision({
      choice: "pricing",
      probabilities: { complaint: 0.05, pricing: 0.9, other: 0.05 },
    });
    fakeAiGateway.object({ product: "Walnut desks", total: 2750 });

    const { result } = await tryInConversation(admin, conversationId, {
      connectionId: google.id,
      sourceRef: message.id,
    });

    expect(result.ended).toBe("partly_failed");
    const { messages } = await getConversation(admin, conversationId);
    const lines = messages.flatMap((m) =>
      m.parts.flatMap((part) => (part.type === "try_it" ? part.lines : [])),
    );
    expect(lines).toContain('route (branch): went on along "Pricing", "Big order".');
    expect(lines.at(-1)).toBe(
      "It partly failed: a step above failed and ended its own path, and the other paths ran on.",
    );
  });

  it("needs the conversation to be about a workflow", async () => {
    const { admin, google, message } = await setUp();
    const { id: conversationId } = await startConversation(admin, {});

    await expect(
      tryInConversation(admin, conversationId, { connectionId: google.id, sourceRef: message.id }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
