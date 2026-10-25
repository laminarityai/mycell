// Ask Mycel reads memory exactly as its person can see it (ADR-0023): their own sources and the
// company-wide ones, never a colleague's private mail, and an admin no more than a member. Each
// read is logged as the agent's, with the person reading (ADR-0024). The conversation keeps
// only the IDs of what was read, never what a fact says (invariant 8).
import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { listAccessLog } from "@/features/memory/server";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { readTurn } from "@/testing/streamed-turn";
import { getConversation, startConversation, streamTurn } from "../server";
import { DANA, DEMO, ORDERS, ROLE, sentToModel, setupMemory } from "./memory-setup";

beforeEach(resetDatabase);

describe("search_memory", () => {
  it("finds a member's own and company-wide facts, never a colleague's private ones", async () => {
    const { orgA } = await setupMemory();
    const member = orgA.member.ctx;
    const { id } = await startConversation(member);
    const before = fakeAiGateway.requests("language").length;
    fakeAiGateway.reply({ toolCalls: [{ name: "search_memory", input: { query: "Dana" } }] });
    fakeAiGateway.reply({ text: "Dana asked for a demo and orders every spring." });

    const turn = await readTurn(await streamTurn(member, id, "What do we know about Dana?"));

    expect(turn.toolCalls).toEqual(["search_memory"]);
    expect(sentToModel(before)).toContain(DEMO);
    expect(sentToModel(before)).toContain(ORDERS);
    expect(sentToModel(before)).not.toContain(ROLE);
    const [read] = await listAccessLog(orgA.admin.ctx);
    expect(read).toMatchObject({
      operation: "search",
      reader: { kind: "agent", userId: orgA.member.id },
      factCount: 2,
    });
  });

  it("finds for an admin what it would for anyone with the same sources: admin rights widen nothing", async () => {
    const { orgA } = await setupMemory();
    const admin = orgA.admin.ctx;
    const { id } = await startConversation(admin);
    const before = fakeAiGateway.requests("language").length;
    fakeAiGateway.reply({ toolCalls: [{ name: "search_memory", input: { query: "Dana" } }] });
    fakeAiGateway.reply({ text: "Dana leads procurement and orders every spring." });

    await readTurn(await streamTurn(admin, id, "What do we know about Dana?"));

    expect(sentToModel(before)).toContain(ROLE);
    expect(sentToModel(before)).toContain(ORDERS);
    expect(sentToModel(before)).not.toContain(DEMO);
    const [read] = await listAccessLog(admin);
    expect(read).toMatchObject({ reader: { kind: "agent", userId: orgA.admin.id }, factCount: 2 });
  });

  it("keeps only the IDs of what it found, never what the facts say", async () => {
    const { orgA } = await setupMemory();
    const member = orgA.member.ctx;
    const { id } = await startConversation(member);
    fakeAiGateway.reply({ toolCalls: [{ name: "search_memory", input: { query: "Dana" } }] });
    fakeAiGateway.reply({ text: "I found two facts about her." });

    const turn = await readTurn(await streamTurn(member, id, "Look up our customer"));

    const conversation = await getConversation(member, id);
    const tool = conversation.messages.at(-1)?.parts.find((part) => part.type === "tool");
    expect(tool).toMatchObject({
      toolName: "search_memory",
      output: {
        factIds: expect.any(Array) as string[],
        objectIds: expect.any(Array) as string[],
        screenedOut: 0,
      },
    });
    for (const statement of [DEMO, ORDERS]) {
      expect(JSON.stringify(conversation)).not.toContain(statement);
      expect(turn.raw).not.toContain(statement);
      expect(await tablesHolding(statement)).not.toContain("agent_messages");
    }
  });
});

describe("read_object", () => {
  it("reads one object by its key, in the person's view, logged as the agent's", async () => {
    const { orgA } = await setupMemory();
    const member = orgA.member.ctx;
    const { id } = await startConversation(member);
    const before = fakeAiGateway.requests("language").length;
    fakeAiGateway.reply({ toolCalls: [{ name: "read_object", input: { email: DANA } }] });
    fakeAiGateway.reply({ text: "Here's Dana." });

    await readTurn(await streamTurn(member, id, "Tell me about Dana"));

    expect(sentToModel(before)).toContain(DEMO);
    expect(sentToModel(before)).toContain(ORDERS);
    expect(sentToModel(before)).not.toContain(ROLE);
    const [read] = await listAccessLog(orgA.admin.ctx);
    expect(read).toMatchObject({
      operation: "read_object",
      reader: { kind: "agent", userId: orgA.member.id },
    });
    const stored = JSON.stringify(await getConversation(member, id));
    expect(stored).not.toContain(DEMO);
  });

  it("tells the model an object it can't see doesn't exist", async () => {
    const { orgA } = await setupMemory();
    const member = orgA.member.ctx;
    const { id } = await startConversation(member);
    fakeAiGateway.reply({
      toolCalls: [{ name: "read_object", input: { email: "nobody@else.example" } }],
    });
    fakeAiGateway.reply({ text: "Memory doesn't know them." });

    const turn = await readTurn(await streamTurn(member, id, "Who is nobody@else.example?"));

    expect(turn.toolErrors).toEqual(["That object doesn't exist."]);
  });
});
