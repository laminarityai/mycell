import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { getBalance, listLedger } from "@/features/credits/server";
import { spendingKindOf } from "@/features/credits/types";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fundOrg, readTurn } from "@/testing/streamed-turn";
import { getConversation, startConversation, streamTurn } from "../server";

beforeEach(resetDatabase);

describe("streamTurn", () => {
  it("streams the scripted reply and stores both messages on the conversation", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const admin = orgA.admin.ctx;
    const { id } = await startConversation(admin, {});
    fakeAiGateway.reply({ text: "Which inbox should it watch?" }, { costUsd: 0.002 });

    const turn = await readTurn(await streamTurn(admin, id, "Draft replies to pricing questions"));

    expect(turn.text).toBe("Which inbox should it watch?");
    expect(turn.deltas).toBeGreaterThan(1);
    const conversation = await getConversation(admin, id);
    expect(conversation.messages).toEqual([
      expect.objectContaining({
        role: "user",
        authorId: admin.userId,
        parts: [{ type: "text", text: "Draft replies to pricing questions" }],
      }),
      expect.objectContaining({
        role: "assistant",
        authorId: null,
        parts: [{ type: "text", text: "Which inbox should it watch?" }],
      }),
    ]);
  });

  it("stops after 8 model steps", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const admin = orgA.admin.ctx;
    const { id } = await startConversation(admin, {});
    for (let step = 0; step < 9; step++) {
      fakeAiGateway.reply({
        toolCalls: [{ name: "get_workflow", input: { workflowId: `missing-${String(step)}` } }],
      });
    }

    const turn = await readTurn(await streamTurn(admin, id, "Look around"));

    expect(turn.toolCalls).toHaveLength(8);
    expect(fakeAiGateway.requests("language")).toHaveLength(8);
    // The ninth script was never asked for; drop it so the test doesn't flag it.
    fakeAiGateway.reset();
  });
});

describe("a failed tool call", () => {
  it("keeps and shows our errors' own messages, and only a generic one for any other", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const admin = orgA.admin.ctx;
    const { id } = await startConversation(admin, {});
    fakeAiGateway.reply({
      toolCalls: [
        { name: "get_workflow", input: { workflowId: "missing" } },
        // Invalid input: the SDK's error quotes it.
        { name: "read_examples", input: { connectionId: "c", query: "quoted-words", limit: 99 } },
      ],
    });
    fakeAiGateway.reply({ text: "Let me try again." });

    const turn = await readTurn(await streamTurn(admin, id, "Look around"));

    // The model is told what was wrong within the turn.
    const next = JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);
    expect(next).toContain("quoted-words");
    const errors = ["That workflow doesn't exist.", "That tool call failed."];
    expect(turn.toolErrors.toSorted()).toEqual(errors.toSorted());
    const reply = (await getConversation(admin, id)).messages.at(-1);
    const outputs = reply?.parts.flatMap((part) =>
      part.type === "tool" && part.isError ? [String(part.output)] : [],
    );
    expect(outputs?.toSorted()).toEqual(errors.toSorted());
  });
});

describe("a turn's credits", () => {
  it("debits the ledger by the cost of every model step in the turn", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id, 1000);
    const admin = orgA.admin.ctx;
    const { id } = await startConversation(admin, {});
    // Two steps: a tool call, then the answer. 0.01 + 0.02 USD is 30 credits at 1000/USD.
    fakeAiGateway.reply(
      { toolCalls: [{ name: "get_workflow", input: { workflowId: "missing" } }] },
      { costUsd: 0.01 },
    );
    fakeAiGateway.reply({ text: "There is no such workflow." }, { costUsd: 0.02 });

    await readTurn(await streamTurn(admin, id, "What does my workflow do?"));

    expect(await getBalance(admin)).toBe(970);
    const [entry] = await listLedger(admin);
    expect(entry).toMatchObject({
      kind: "usage",
      role: "smart",
      modelId: "test/smart-default",
      outcome: "succeeded",
      costUsd: 0.03,
      purpose: "builder",
    });
    expect(spendingKindOf(entry)).toBe("builder");
  });

  it("records the cost of the steps that ran when a turn ends early", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id, 1000);
    const admin = orgA.admin.ctx;
    const { id } = await startConversation(admin, {});
    fakeAiGateway.reply(
      { toolCalls: [{ name: "get_workflow", input: { workflowId: "missing" } }] },
      { costUsd: 0.01 },
    );
    fakeAiGateway.fail("language", { streaming: true, status: 500 });

    const turn = await readTurn(await streamTurn(admin, id, "What does my workflow do?"));

    expect(turn.errors).not.toEqual([]);
    expect(await getBalance(admin)).toBe(990);
    expect((await listLedger(admin)).at(0)).toMatchObject({
      outcome: "failed",
      costUsd: 0.01,
      purpose: "builder",
    });
    const reply = (await getConversation(admin, id)).messages.at(-1);
    expect(reply?.parts.at(-1)).toMatchObject({ type: "notice", kind: "failed" });
  });

  it("calls no model out of credits, and the conversation says why", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    const { id } = await startConversation(admin, {});

    const turn = await readTurn(await streamTurn(admin, id, "Draft replies to pricing questions"));

    expect(fakeAiGateway.requests()).toEqual([]);
    const outOfCredits = { kind: "out_of_credits", text: "Your organization is out of credits." };
    expect(turn.notices).toEqual([outOfCredits]);
    expect((await getConversation(admin, id)).messages.map((m) => m.parts)).toEqual([
      [{ type: "text", text: "Draft replies to pricing questions" }],
      [{ type: "notice", ...outOfCredits }],
    ]);
    expect(await listLedger(admin)).toEqual([]);
  });
});
