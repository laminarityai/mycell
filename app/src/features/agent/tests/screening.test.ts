// Everything Ask Mycel's tools hand the model is screened for prompt injection first (ADR-0023,
// Google's restricted-scope rules): a flagged fact or subject is dropped with a short note and
// never reaches the model. With no screen configured, the memory tools say memory is
// unavailable and read nothing. Each screen is metered as the agent's.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { env } from "@/env";
import { listLedger } from "@/features/credits/server";
import { listAccessLog } from "@/features/memory/server";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeModelArmor } from "@/testing/fake-model-armor";
import { readTurn } from "@/testing/streamed-turn";
import type { Ctx } from "@/lib/ctx";
import { getConversation, startConversation, streamTurn } from "../server";
import { DANA, DEMO, ORDERS, sentToModel, setupMemory } from "./memory-setup";

beforeEach(resetDatabase);

/** A turn in which the agent calls `tool` with `input`, then answers. */
async function callTool(ctx: Ctx, tool: string, input: Record<string, unknown>) {
  const { id } = await startConversation(ctx);
  const before = fakeAiGateway.requests("language").length;
  fakeAiGateway.reply({ toolCalls: [{ name: tool, input }] });
  fakeAiGateway.reply({ text: "Here's what I found." });
  const turn = await readTurn(await streamTurn(ctx, id, "What do we know about Dana?"));
  return { turn, id, sent: sentToModel(before) };
}

describe("screening what the memory tools found", () => {
  it("drops a flagged fact with a note, and the model never sees it", async () => {
    const { orgA } = await setupMemory();
    fakeModelArmor.flagText("demo of the oak range");

    const { sent, id } = await callTool(orgA.member.ctx, "search_memory", { query: "Dana" });

    expect(sent).not.toContain(DEMO);
    expect(sent).toContain(ORDERS);
    expect(sent).toContain("screenedOut");
    const reply = (await getConversation(orgA.member.ctx, id)).messages.at(-1);
    expect(reply?.parts.find((part) => part.type === "tool")).toMatchObject({
      output: { screenedOut: 1 },
    });
  });

  it("drops a flagged subject with every fact about it", async () => {
    const { orgA } = await setupMemory();
    fakeModelArmor.flagText("Dana Ruiz");

    const { sent } = await callTool(orgA.member.ctx, "search_memory", { query: "Dana" });

    expect(sent).not.toContain("Dana Ruiz");
    expect(sent).not.toContain(DEMO);
    expect(sent).not.toContain(ORDERS);
  });

  it("drops a flagged object read whole, saying only that it was left out", async () => {
    const { orgA } = await setupMemory();
    fakeModelArmor.flagText("Dana Ruiz");

    const { sent } = await callTool(orgA.member.ctx, "read_object", { email: DANA });

    expect(sent).not.toContain("Dana Ruiz");
    expect(sent).not.toContain(DEMO);
    expect(sent).toContain("screenedOut");
  });

  it("screens each result once when nothing is flagged, metered as the agent's", async () => {
    const { orgA } = await setupMemory();
    const screened = fakeModelArmor.screened().length;

    await callTool(orgA.member.ctx, "search_memory", { query: "Dana" });

    const texts = fakeModelArmor.screened().slice(screened);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain(DEMO);
    const screens = (await listLedger(orgA.admin.ctx)).filter(
      (entry) => entry.modelId === "google/model-armor" && entry.purpose === "agent",
    );
    expect(screens).toHaveLength(1);
  });

  it("says memory is unavailable when the screen fails, and hands the model nothing", async () => {
    const { orgA } = await setupMemory();
    fakeModelArmor.fail(500);

    const { sent } = await callTool(orgA.member.ctx, "search_memory", { query: "Dana" });

    expect(sent).not.toContain(DEMO);
    expect(sent).not.toContain(ORDERS);
    expect(sent).toContain("unavailable");
  });
});

describe("with no injection screen configured", () => {
  it("says memory is unavailable, and reads none of it", async () => {
    const { orgA } = await setupMemory();
    const logged = (await listAccessLog(orgA.admin.ctx)).length;
    // The env is parsed once at startup; this stands in for a deployment without a screen.
    const template = env.MODEL_ARMOR_TEMPLATE;
    env.MODEL_ARMOR_TEMPLATE = undefined;
    try {
      for (const [tool, input] of [
        ["search_memory", { query: "Dana" }],
        ["read_object", { email: DANA }],
      ] as const) {
        const { sent, id } = await callTool(orgA.member.ctx, tool, input);

        expect(sent).not.toContain(DEMO);
        expect(sent).toContain("unavailable");
        const reply = (await getConversation(orgA.member.ctx, id)).messages.at(-1);
        expect(reply?.parts.find((part) => part.type === "tool")).toMatchObject({
          output: { available: false },
        });
      }
    } finally {
      env.MODEL_ARMOR_TEMPLATE = template;
    }
    expect(await listAccessLog(orgA.admin.ctx)).toHaveLength(logged);
  });
});
