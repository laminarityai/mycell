// An Ask Mycel turn is `models`' metered chat turn on the `smart` role (spec #154): streamed,
// bounded, credits first, and charged to the agent.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { getBalance, listLedger } from "@/features/credits/server";
import { spendingKindOf } from "@/features/credits/types";
import { ValidationError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fundOrg, readTurn } from "@/testing/streamed-turn";
import { getConversation, startConversation, streamTurn } from "../server";

beforeEach(resetDatabase);

describe("streamTurn", () => {
  it("streams the reply and stores both messages", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const member = orgA.member.ctx;
    const { id } = await startConversation(member);
    fakeAiGateway.reply({ text: "Memory doesn't know who handles Acme's renewals." });

    const turn = await readTurn(await streamTurn(member, id, "Who handles Acme's renewals?"));

    expect(turn.text).toBe("Memory doesn't know who handles Acme's renewals.");
    expect(turn.deltas).toBeGreaterThan(1);
    expect((await getConversation(member, id)).messages).toEqual([
      expect.objectContaining({
        role: "user",
        parts: [{ type: "text", text: "Who handles Acme's renewals?" }],
      }),
      expect.objectContaining({
        role: "assistant",
        parts: [{ type: "text", text: "Memory doesn't know who handles Acme's renewals." }],
      }),
    ]);
    // The model is told what it is and how to answer, then the person's words.
    const [request] = fakeAiGateway.requests("language");
    const sent = JSON.stringify(request.body);
    expect(sent).toContain("Who handles Acme's renewals?");
    expect(sent).toContain("Never claim");
  });

  it("gives the model the conversation so far", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const member = orgA.member.ctx;
    const { id } = await startConversation(member);
    fakeAiGateway.reply({ text: "Acme renews in March." });
    await readTurn(await streamTurn(member, id, "When does Acme renew?"));
    fakeAiGateway.reply({ text: "In about five months." });

    await readTurn(await streamTurn(member, id, "How long is that?"));

    const sent = JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);
    expect(sent).toContain("When does Acme renew?");
    expect(sent).toContain("Acme renews in March.");
  });

  it("refuses an empty message", async () => {
    const { orgA } = await seedTwoOrgs();
    const { id } = await startConversation(orgA.member.ctx);

    await expect(streamTurn(orgA.member.ctx, id, "   ")).rejects.toThrow(ValidationError);
  });

  it("stops after 6 model steps", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const { id } = await startConversation(orgA.member.ctx);
    for (let step = 0; step < 7; step++) {
      fakeAiGateway.reply({
        toolCalls: [{ name: "read_object", input: { objectId: `missing-${String(step)}` } }],
      });
    }

    const turn = await readTurn(await streamTurn(orgA.member.ctx, id, "Look around"));

    expect(turn.toolCalls).toHaveLength(6);
    expect(fakeAiGateway.requests("language")).toHaveLength(6);
    // The seventh script was never asked for; drop it so the test doesn't flag it.
    fakeAiGateway.reset();
  });
});

describe("a turn's credits", () => {
  it("debits the ledger by every step's cost, as the agent's spending", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id, 1000);
    const member = orgA.member.ctx;
    const { id } = await startConversation(member);
    fakeAiGateway.reply(
      { toolCalls: [{ name: "read_object", input: { objectId: "missing" } }] },
      { costUsd: 0.01 },
    );
    fakeAiGateway.reply({ text: "Memory doesn't know." }, { costUsd: 0.02 });

    await readTurn(await streamTurn(member, id, "Tell me about Acme"));

    expect(await getBalance(orgA.admin.ctx)).toBe(970);
    const [entry] = await listLedger(orgA.admin.ctx);
    expect(entry).toMatchObject({
      kind: "usage",
      role: "smart",
      modelId: "test/smart-default",
      costUsd: 0.03,
      purpose: "agent",
    });
    expect(spendingKindOf(entry)).toBe("agent");
  });

  it("out of credits, calls no model and stores a notice saying why", async () => {
    const { orgA } = await seedTwoOrgs();
    const member = orgA.member.ctx;
    const { id } = await startConversation(member);

    const turn = await readTurn(await streamTurn(member, id, "Tell me about Acme"));

    expect(fakeAiGateway.requests()).toEqual([]);
    expect(turn.notices).toEqual([
      { kind: "out_of_credits", text: "Your organization is out of credits." },
    ]);
    expect((await getConversation(member, id)).messages.at(-1)).toMatchObject({
      role: "assistant",
      parts: [
        { type: "notice", kind: "out_of_credits", text: "Your organization is out of credits." },
      ],
    });
  });
});
