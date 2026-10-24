// Searching Ask Mycel's conversations (#180): the person's own conversations only, by the words
// of their titles and of what's stored as text (the person's messages and Mycel's replies),
// never what a tool read or a notice, in one query, in the rail's order.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fundOrg, readTurn } from "@/testing/streamed-turn";
import type { ConversationHit, MarkedText } from "../types";
import { listRail, searchConversations, startConversation, streamTurn } from "../server";
import { DEMO, setupMemory } from "./memory-setup";

beforeEach(resetDatabase);

/** Starts a conversation of one turn per question, Mycel replying with each reply. */
async function converse(ctx: Ctx, turns: [question: string, reply: string][]): Promise<string> {
  const { id } = await startConversation(ctx);
  for (const [question, reply] of turns) {
    fakeAiGateway.reply({ text: reply });
    await readTurn(await streamTurn(ctx, id, question));
  }
  return id;
}

/** The words a search marked as matching. */
const marked = (text: MarkedText | null) =>
  (text ?? []).filter((piece) => piece.match).map((piece) => piece.text);
/** The whole text, marks dropped. */
const plain = (text: MarkedText | null) => (text ?? []).map((piece) => piece.text).join("");
const ids = (hits: ConversationHit[]) => hits.map((hit) => hit.id);

describe("searching a person's conversations", () => {
  it("finds a word in a title, in a later question and in a reply", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const member = orgA.member.ctx;
    const titled = await converse(member, [["What did we agree with Acme?", "Nothing yet."]]);
    const asked = await converse(member, [
      ["Who handles invoices?", "Usually Tom."],
      ["And for Brightline?", "Nothing on that."],
    ]);
    const replied = await converse(member, [["Who runs renewals?", "Priya runs them."]]);

    const [byTitle] = await searchConversations(member, "acme");
    expect(byTitle).toMatchObject({ id: titled, title: "What did we agree with Acme?" });
    expect(marked(byTitle.titleMatch)).toEqual(["Acme"]);
    expect(plain(byTitle.titleMatch)).toBe("What did we agree with Acme?");

    const [byQuestion] = await searchConversations(member, "Brightline");
    expect(byQuestion.id).toBe(asked);
    // The title is the first question, which doesn't say Brightline.
    expect(byQuestion.titleMatch).toBeNull();
    expect(marked(byQuestion.snippet)).toEqual(["Brightline"]);
    expect(plain(byQuestion.snippet)).toContain("And for Brightline");

    const [byReply] = await searchConversations(member, "priya");
    expect(byReply.id).toBe(replied);
    expect(byReply.titleMatch).toBeNull();
    expect(marked(byReply.snippet)).toEqual(["Priya"]);
  });

  it("matches the start of a word and its other forms, as it's typed", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const member = orgA.member.ctx;
    const id = await converse(member, [
      ["When does Brightline renew?", "Its renewals are in May."],
    ]);

    expect(ids(await searchConversations(member, "bright"))).toEqual([id]);
    const [hit] = await searchConversations(member, "Renewal");
    expect(hit.id).toBe(id);
    expect(marked(hit.snippet)).toEqual(["renew"]);
  });

  it("needs every word of the search in one title or message", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const member = orgA.member.ctx;
    const both = await converse(member, [["Did Acme pay Priya's invoice?", "Not yet."]]);
    await converse(member, [["What about Acme?", "Nothing."]]);

    expect(ids(await searchConversations(member, "acme invoice"))).toEqual([both]);
    expect(await searchConversations(member, "acme brightline")).toEqual([]);
  });

  it("lists its hits most recently active first, as the rail does", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const member = orgA.member.ctx;
    const older = await converse(member, [["Acme's renewal date?", "March."]]);
    const newer = await converse(member, [["Acme's buyer?", "Dana."]]);
    await converse(member, [["Brightline's buyer?", "Nobody yet."]]);

    expect(ids(await searchConversations(member, "acme"))).toEqual([newer, older]);
    // Continuing the older one makes it the most recently active.
    fakeAiGateway.reply({ text: "Still March." });
    await readTurn(await streamTurn(member, older, "Still?"));
    expect(ids(await searchConversations(member, "acme"))).toEqual([older, newer]);
  });

  it("never finds a colleague's or an admin's conversations, nor shows theirs to an admin", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const { member, admin } = orgA;
    const colleague = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
    const own = await converse(member.ctx, [["Acme's renewal?", "March."]]);
    const adminOwn = await converse(admin.ctx, [["Acme's margin?", "Thin."]]);
    await converse(colleague.ctx, [["Acme's buyer?", "Dana."]]);

    expect(ids(await searchConversations(member.ctx, "acme"))).toEqual([own]);
    expect(ids(await searchConversations(admin.ctx, "acme"))).toEqual([adminOwn]);
    expect(await searchConversations(member.ctx, "margin")).toEqual([]);
    expect(await searchConversations(admin.ctx, "renewal")).toEqual([]);
    await expect(searchConversations(systemCtx(orgA.id), "acme")).rejects.toThrow(ForbiddenError);
  });

  it("searches only stored text: never what a tool read or a notice", async () => {
    const { orgA } = await setupMemory();
    const member = orgA.member.ctx;
    const { id } = await startConversation(member);
    fakeAiGateway.reply({ toolCalls: [{ name: "search_memory", input: { query: "Dana" } }] });
    fakeAiGateway.reply({ text: "She asked to see something." });
    await readTurn(await streamTurn(member, id, "What did Dana want?"));

    // The fact the tool read says "demo" and "oak"; the conversation stored neither.
    expect(DEMO).toContain("demo");
    expect(await searchConversations(member, "demo")).toEqual([]);
    expect(await searchConversations(member, "oak")).toEqual([]);
    // Nor the tool call's own input.
    expect(ids(await searchConversations(member, "dana"))).toEqual([id]);
    expect(await searchConversations(member, "search_memory")).toEqual([]);
  });

  it("doesn't find a notice's words", async () => {
    const { orgA } = await seedTwoOrgs();
    const member = orgA.member.ctx;
    // Unfunded, the turn stores an out-of-credits notice.
    const { id } = await startConversation(member);
    await readTurn(await streamTurn(member, id, "Hello there"));

    expect(await searchConversations(member, "credits")).toEqual([]);
    expect(ids(await searchConversations(member, "hello"))).toEqual([id]);
  });

  it("finds nothing, and asks the database nothing, for a search with no words", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const member = orgA.member.ctx;
    await converse(member, [["Acme?", "Yes."]]);

    for (const query of ["", "   ", "&|!:*()"]) {
      const searched = await countQueries(async () => {
        expect(await searchConversations(member, query)).toEqual([]);
      });
      expect(searched.queries).toBe(0);
    }
  });

  it("treats query syntax and highlight markers in text as plain characters", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const member = orgA.member.ctx;
    const id = await converse(member, [["Acme \uE000ships\uE001 by sea?", "By air."]]);

    expect(ids(await searchConversations(member, "acme & !ships:* | ("))).toEqual([id]);
    const [hit] = await searchConversations(member, "ships");
    expect(marked(hit.snippet)).toEqual(["ships"]);
    // A word longer than Postgres takes is cut short, not refused.
    expect(await searchConversations(member, "x".repeat(5000))).toEqual([]);
  });

  it("lists the rail's conversations, or a search's hits", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const member = orgA.member.ctx;
    const acme = await converse(member, [["Acme?", "Yes."]]);
    const other = await converse(member, [["Brightline?", "No."]]);

    expect(await listRail(member, undefined)).toEqual({
      query: null,
      conversations: [
        expect.objectContaining({ id: other }),
        expect.objectContaining({ id: acme }),
      ],
    });
    expect(await listRail(member, "acme")).toEqual({
      query: "acme",
      hits: [expect.objectContaining({ id: acme })],
    });
  });
});
