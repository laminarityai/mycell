// "Remember this" (M9): the agent's `remember` tool saves a fact the person told it, visible only
// to them, and says what it saved and about whom. Their later questions find it; a colleague's
// don't. Refusals (the do-not-learn list, what isn't a work fact) are said plainly. The
// conversation keeps only the IDs of what was saved.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { forgetPerson } from "@/features/memory/server";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { scriptTelling } from "@/testing/memory-learning";
import { readTurn } from "@/testing/streamed-turn";
import type { Ctx } from "@/lib/ctx";
import { getConversation, startConversation, streamTurn } from "../server";
import { DANA, sentToModel, setupMemory } from "./memory-setup";

beforeEach(resetDatabase);

const NOTE = "Dana Ruiz prefers a call to an email.";
const SAVED = `Saved about Dana Ruiz: ${NOTE} Only you can see this.`;

/** A turn in which the agent calls `tool` with `input`, then answers. */
async function callTool(ctx: Ctx, tool: string, input: Record<string, unknown>, ask: string) {
  const { id } = await startConversation(ctx);
  const before = fakeAiGateway.requests("language").length;
  fakeAiGateway.reply({ toolCalls: [{ name: tool, input }] });
  fakeAiGateway.reply({ text: "Done." });
  const turn = await readTurn(await streamTurn(ctx, id, ask));
  return { turn, id, sent: sentToModel(before) };
}

const toolPart = async (ctx: Ctx, id: string) =>
  (await getConversation(ctx, id)).messages.at(-1)?.parts.find((part) => part.type === "tool");

describe("remember", () => {
  it("saves a note only its person sees, says so, and their later questions find it", async () => {
    const { orgA } = await setupMemory();
    const member = orgA.member.ctx;

    scriptTelling();
    const { turn, id, sent } = await callTool(
      member,
      "remember",
      { email: DANA, statement: NOTE },
      `Remember that ${NOTE}`,
    );

    expect(turn.toolCalls).toEqual(["remember"]);
    expect(sent).toContain(SAVED);
    expect(await toolPart(member, id)).toMatchObject({
      toolName: "remember",
      output: {
        saved: true,
        factIds: [expect.any(String) as string],
        objectIds: [expect.any(String) as string],
      },
    });
    // The conversation keeps the IDs, not the note: the person's own message holds their words.
    expect(JSON.stringify((await toolPart(member, id))?.output)).not.toContain(NOTE);

    const later = await callTool(member, "search_memory", { query: "Dana" }, "Who's Dana?");
    expect(later.sent).toContain(NOTE);
    expect(later.sent).toContain('"toldByYou":true');
    const colleague = await callTool(orgA.admin.ctx, "search_memory", { query: "Dana" }, "Dana?");
    expect(colleague.sent).not.toContain(NOTE);
  });

  it("says plainly why it won't remember someone on the do-not-learn list", async () => {
    const { orgA } = await setupMemory();
    const member = orgA.member.ctx;
    await forgetPerson(orgA.admin.ctx, { email: "priya@globex.example" });

    const { id, sent } = await callTool(
      member,
      "remember",
      { email: "priya@globex.example", name: "Priya Shah", statement: "Priya runs Globex." },
      "Remember that Priya runs Globex",
    );

    expect(sent).toContain("forget");
    expect(await toolPart(member, id)).toMatchObject({
      toolName: "remember",
      output: { saved: false, reason: "forgotten" },
    });
  });

  it("says plainly it won't remember an opinion about a colleague", async () => {
    const { orgA } = await setupMemory();
    const member = orgA.member.ctx;

    scriptTelling({ kind: "opinion" });
    const { sent } = await callTool(
      member,
      "remember",
      { email: orgA.admin.email, statement: "Alex is slow to reply." },
      "Remember that Alex is slow to reply",
    );

    expect(sent).toContain("opinions");
  });
});
