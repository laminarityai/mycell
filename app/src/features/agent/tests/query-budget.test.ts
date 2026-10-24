// Ask Mycel's reads must not grow with what they show: the conversation list is one read
// however many conversations there are, a search is one query however many it finds, and a
// conversation, with its citations and what its tools found, is the same reads for one cited
// fact, message, review or workflow as for several.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { searchMemory } from "@/features/memory/server";
import { createReview } from "@/features/reviews/server";
import { enable } from "@/features/workflows/server";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fundOrg, readTurn } from "@/testing/streamed-turn";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import { systemCtx, type Ctx } from "@/lib/ctx";
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

  it("reads what a conversation's mail and work tools found with the same queries for 1 or several", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const { admin, member } = orgA;
    const box = await connectMailbox(member.ctx, member.email);
    await connectMailbox(admin.ctx, admin.email);
    await tagUsers(admin.ctx, "sales", [member]);
    const add = async (n: number) => {
      box.mailbox.add({ from: "ada@acme.example", subject: `Chairs ${String(n)}`, at: daysAgo(n) });
      const spec = { ...labels, id: `labels-${String(n)}` };
      const { workflowId, version } = await publishTo(admin.ctx, `Labels ${String(n)}`, spec, [
        "sales",
      ]);
      await enable(member.ctx, workflowId);
      await createReview(systemCtx(orgA.id), {
        runId: randomUUID(),
        connectionId: box.id,
        workflowId,
        workflowVersionId: version.id,
        kind: "approval",
        itemRef: `draft-${String(n)}`,
        threadRef: `thread-${String(n)}`,
        sourceRef: `message-${String(n)}`,
      });
    };
    const lookedAround = async () => {
      const { id } = await startConversation(member.ctx);
      for (const name of ["find_messages", "list_reviews", "list_workflows"]) {
        fakeAiGateway.reply({ toolCalls: [{ name, input: {} }] });
      }
      fakeAiGateway.reply({ text: "Here's everything." });
      await readTurn(await streamTurn(member.ctx, id, "What's going on?"));
      return id;
    };
    const read = (id: string) =>
      countQueries(async () => {
        const { found } = await getConversation(member.ctx, id);
        return found;
      });
    await add(1);
    const one = await lookedAround();
    await add(2);
    await add(3);
    const three = await lookedAround();

    const [readOne, readThree] = [await read(one), await read(three)];
    expect(readThree.queries).toBe(readOne.queries);
    const { found } = await getConversation(member.ctx, three);
    expect([found.messages.length, found.reviews.length, found.workflows.length]).toEqual([
      3, 3, 3,
    ]);
  });
});

const labels = {
  specVersion: 1,
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  steps: [
    {
      id: "label",
      type: "tool",
      action: "google-mail.add-label",
      input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
    },
  ],
  autonomy: { rung: 3 },
};
