// Ask Mycel's reads must not grow with what they show: the conversation list is one read
// however many conversations there are, a search is one query however many it finds, and a
// conversation, with its citations, is the same reads for one cited fact as for several.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { searchMemory } from "@/features/memory/server";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { readTurn } from "@/testing/streamed-turn";
import type { Ctx } from "@/lib/ctx";
import {
  getConversation,
  listConversations,
  searchConversations,
  startConversation,
  streamTurn,
} from "../server";
import { setupMemory } from "./memory-setup";

beforeEach(resetDatabase);

/** A conversation with one turn that searched memory and cited `cited` of the facts found. */
async function citedConversation(ctx: Ctx, cited: number): Promise<string> {
  const { id } = await startConversation(ctx);
  const { facts } = await searchMemory(ctx, { text: "Dana" });
  fakeAiGateway.reply({ toolCalls: [{ name: "search_memory", input: { query: "Dana" } }] });
  fakeAiGateway.reply({
    text: facts
      .slice(0, cited)
      .map((fact) => `A fact. [fact:${fact.id}]`)
      .join(" "),
  });
  await readTurn(await streamTurn(ctx, id, `Question ${String(cited)}`));
  return id;
}

describe("Ask Mycel's query budget", () => {
  it("lists 1 conversation or 5 with the same queries", async () => {
    const { orgA } = await setupMemory();
    const member = orgA.member.ctx;
    await citedConversation(member, 1);
    const list = () => countQueries(() => listConversations(member));

    const one = await list();
    for (let n = 0; n < 4; n += 1) await citedConversation(member, 1);
    const five = await list();

    expect(five.queries).toBe(one.queries);
  });

  it("searches 1 conversation or 5 in one query", async () => {
    const { orgA } = await setupMemory();
    const member = orgA.member.ctx;
    await citedConversation(member, 1);
    // "Question" is in each conversation's title and question, "fact" in its reply.
    const search = (expected: number) =>
      countQueries(async () => {
        expect(await searchConversations(member, "question")).toHaveLength(expected);
        expect(await searchConversations(member, "fact")).toHaveLength(expected);
      });

    const one = await search(1);
    for (let n = 0; n < 4; n += 1) await citedConversation(member, 1);
    const five = await search(5);

    expect(one.queries).toBe(2);
    expect(five.queries).toBe(2);
  });

  it("reads a conversation citing 1 fact or several with the same queries", async () => {
    const { orgA } = await setupMemory();
    const member = orgA.member.ctx;
    const one = await citedConversation(member, 1);
    const both = await citedConversation(member, 2);
    const read = (id: string) =>
      countQueries(async () => {
        const conversation = await getConversation(member, id);
        expect(conversation.citations.length).toBeGreaterThan(0);
      });

    expect((await read(both)).queries).toBe((await read(one)).queries);
  });
});
