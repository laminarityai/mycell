import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { getBalance, listLedger } from "@/features/credits/server";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fundOrg, readTurn } from "@/testing/streamed-turn";
import { askTurn, type AskTurn, type StoredAskMessage } from "./second-chat";

beforeEach(resetDatabase);

// A chat other than the builder's runs a whole metered turn through `streamChatTurn`.
describe("a second chat's turn", () => {
  it("streams the reply, stores it, and records one usage entry with the chat's attribution", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const member = orgA.member.ctx;
    const stored: StoredAskMessage[] = [];
    fakeAiGateway.reply({ text: "Priya handles Acme's renewals." }, { costUsd: 0.002 });

    const turn = await readTurn(
      await askTurn(member, "Who handles Acme?", stored, undefined, {
        attribution: { workflowId: "w-ask" },
      }),
    );

    expect(turn.text).toBe("Priya handles Acme's renewals.");
    expect(turn.deltas).toBeGreaterThan(1);
    expect(stored.map((message) => message.parts)).toEqual([
      [{ type: "text", text: "Priya handles Acme's renewals." }],
    ]);
    const request = fakeAiGateway.requests("language").at(0);
    expect([request?.modelId, request?.streaming]).toEqual(["test/smart-default", true]);
    expect(JSON.stringify(request?.body)).toContain("Answer from your tools only.");
    expect((await listLedger(orgA.admin.ctx)).at(0)).toMatchObject({
      kind: "usage",
      role: "smart",
      costUsd: 0.002,
      outcome: "succeeded",
      workflowId: "w-ask",
    });
  });

  it("runs its own tools on its own turn context, and keeps only each tool's stored view", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const member = orgA.member.ctx;
    const stored: StoredAskMessage[] = [];
    const context: AskTurn = { asker: member.userId, lookedUp: [] };
    fakeAiGateway.reply({ toolCalls: [{ name: "look_up", input: { name: "Acme" } }] });
    fakeAiGateway.reply({ text: "Found Acme." });

    const turn = await readTurn(await askTurn(member, "Look up Acme", stored, context));

    expect(context.lookedUp).toEqual(["Acme"]);
    // The model got the whole result within the turn; the page and the conversation don't.
    expect(JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body)).toContain(
      "fetched-words",
    );
    expect(turn.toolCalls).toEqual(["look_up"]);
    expect(turn.raw).not.toContain("fetched-words");
    expect(stored.at(0)?.parts).toEqual([
      expect.objectContaining({
        type: "tool",
        toolName: "look_up",
        input: { name: "Acme" },
        output: { objectId: "object-Acme" },
        isError: false,
      }),
      { type: "text", text: "Found Acme." },
    ]);
  });

  it("keeps our errors' own messages, and only a generic one for any other", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const stored: StoredAskMessage[] = [];
    fakeAiGateway.reply({
      toolCalls: [
        { name: "look_up", input: { name: "Nobody" } },
        // Invalid input: the SDK's error quotes it.
        { name: "look_up", input: { name: "", note: "quoted-words" } },
      ],
    });
    fakeAiGateway.reply({ text: "Let me try again." });

    const turn = await readTurn(await askTurn(orgA.member.ctx, "Look around", stored));

    const errors = ["That person doesn't exist.", "That tool call failed."];
    expect(turn.toolErrors.toSorted()).toEqual(errors.toSorted());
    // The page gets only these, never the SDK's error, which quotes the model's input.
    expect(turn.raw).not.toContain("Invalid input");
    const outputs = stored
      .at(0)
      ?.parts.flatMap((part) =>
        part.type === "tool" && part.isError ? [String(part.output)] : [],
      );
    expect(outputs?.toSorted()).toEqual(errors.toSorted());
  });

  it("stops at the chat's own step cap", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    for (let step = 0; step < 3; step++) {
      fakeAiGateway.reply({
        toolCalls: [{ name: "look_up", input: { name: `p${String(step)}` } }],
      });
    }

    const turn = await readTurn(
      await askTurn(orgA.member.ctx, "Look around", [], undefined, { maxSteps: 2 }),
    );

    expect(turn.toolCalls).toHaveLength(2);
    expect(fakeAiGateway.requests("language")).toHaveLength(2);
    // The third script was never asked for; drop it so the test doesn't flag it.
    fakeAiGateway.reset();
  });

  it("ends a failed turn with the chat's own notice, and records the steps that ran", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id, 1000);
    const member = orgA.member.ctx;
    const stored: StoredAskMessage[] = [];
    fakeAiGateway.reply(
      { toolCalls: [{ name: "look_up", input: { name: "Acme" } }] },
      { costUsd: 0.01 },
    );
    fakeAiGateway.fail("language", { streaming: true, status: 500 });

    const turn = await readTurn(await askTurn(member, "Look up Acme", stored));

    expect(turn.errors).toEqual(["Ask Mycel stopped before it finished."]);
    expect(stored.at(0)?.parts.at(-1)).toEqual({
      type: "notice",
      kind: "failed",
      text: "Ask Mycel stopped before it finished.",
    });
    expect(await getBalance(member)).toBe(990);
    expect((await listLedger(orgA.admin.ctx)).at(0)).toMatchObject({
      outcome: "failed",
      costUsd: 0.01,
    });
  });

  it("calls no model out of credits, and stores and streams a notice saying why", async () => {
    const { orgA } = await seedTwoOrgs();
    const member = orgA.member.ctx;
    const stored: StoredAskMessage[] = [];

    const turn = await readTurn(await askTurn(member, "Who handles Acme?", stored));

    expect(fakeAiGateway.requests()).toEqual([]);
    const outOfCredits = { kind: "out_of_credits", text: "Your organization is out of credits." };
    expect(turn.notices).toEqual([outOfCredits]);
    expect(stored.map((message) => message.parts)).toEqual([[{ type: "notice", ...outOfCredits }]]);
    expect(await listLedger(orgA.admin.ctx)).toEqual([]);
  });
});
