// The builder reads company-wide memory only (ADR-0023): a context section found by the admin's
// message, and the search_memory tool, each in the view an org-credential run has. Builder
// conversations are shared among admins and keep the agent's replies whole, so a fact from one
// admin's private mail must never reach the agent. Each read is still logged as the builder's,
// with the admin as the person reading. A conversation keeps the IDs of what was found, never
// what the facts say.
import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, type FixtureOrg } from "@/db/testing/two-org-fixture";
import type { ConnectionKind } from "@/features/connections/types";
import { backfillConnection } from "@/features/discovery/server";
import { listAccessLog, startMemory } from "@/features/memory/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import {
  learnStoredItems,
  scriptLearning,
  type ScriptedExtraction,
} from "@/testing/memory-learning";
import { saveWorkflow } from "@/features/workflows/server";
import { fundOrg, readTurn } from "@/testing/streamed-turn";
import { getConversation, startConversation, streamTurn, tryInConversation } from "../server";

beforeEach(resetDatabase);

const DANA = "dana@acme.example";
const ROLE = "Dana Ruiz leads procurement at Acme.";
const DEMO = "Dana Ruiz asked for a demo of the oak range.";
const ORDERS = "Dana Ruiz orders oak chairs every spring.";
const dana = { ref: "dana", kind: "person" as const, name: "Dana Ruiz", email: DANA };

const learned = (statement: string, evidence: string): ScriptedExtraction => ({
  objects: [dana],
  facts: [{ about: "dana", statement, evidence }],
});

async function learnFrom(
  org: FixtureOrg,
  ctx: Ctx,
  address: string,
  text: string,
  learning: ScriptedExtraction,
  kind: ConnectionKind = "member",
) {
  const box = await connectMailbox(
    ctx,
    address,
    [{ from: `Dana Ruiz <${DANA}>`, to: [address], subject: "Oak chairs", text, at: daysAgo(2) }],
    kind,
  );
  await backfillConnection(ctx, box.id);
  scriptLearning(learning);
  await learnStoredItems(org.id);
  const sourceRef = box.mailbox.list(new URLSearchParams()).messages?.at(0)?.id ?? "";
  return { connectionId: box.id, sourceRef };
}

// Dana told the admin her role privately, asked the member for a demo privately, and wrote to
// the company's sales inbox (an org connection) about her orders: only that is company-wide.
async function setup() {
  const { orgA } = await seedTwoOrgs();
  await fundOrg(orgA.id);
  // Memory learns nothing until an admin starts it.
  await startMemory(systemCtx(orgA.id), { monthlyBudget: 1000 });
  const { admin, member } = orgA;
  const lead = "I lead procurement at Acme";
  const own = await learnFrom(orgA, admin.ctx, admin.email, `Hi, ${lead}.`, learned(ROLE, lead));
  const ask = "Could we see a demo of the oak range?";
  await learnFrom(orgA, member.ctx, member.email, ask, learned(DEMO, ask));
  const spring = "We order oak chairs every spring";
  await learnFrom(
    orgA,
    admin.ctx,
    `sales@${orgA.workspaceDomain}`,
    `${spring}.`,
    learned(ORDERS, spring),
    "org",
  );
  return { orgA, own };
}

/** Everything sent to the model since `from` requests: a turn's every step together. */
const sentToModel = (from: number) =>
  JSON.stringify(fakeAiGateway.requests("language").slice(from));

describe("the builder's memory context", () => {
  it("holds the company-wide facts the admin's message finds, never the admin's private ones", async () => {
    const { orgA } = await setup();
    const { id } = await startConversation(orgA.admin.ctx, {});
    const before = fakeAiGateway.requests("language").length;
    fakeAiGateway.reply({ text: "Noted." });

    await readTurn(await streamTurn(orgA.admin.ctx, id, "Draft replies to Dana Ruiz at Acme"));

    expect(sentToModel(before)).toContain(ORDERS);
    expect(sentToModel(before)).not.toContain(ROLE);
    expect(sentToModel(before)).not.toContain(DEMO);
    const [read] = await listAccessLog(orgA.admin.ctx);
    expect(read).toMatchObject({
      operation: "search",
      reader: { kind: "builder", userId: orgA.admin.id },
      factCount: 1,
    });
  });
});

describe("search_memory", () => {
  it("returns company-wide facts to the model, never the admin's private ones, and the conversation keeps only IDs", async () => {
    const { orgA } = await setup();
    const { id } = await startConversation(orgA.admin.ctx, {});
    const before = fakeAiGateway.requests("language").length;
    fakeAiGateway.reply({ toolCalls: [{ name: "search_memory", input: { query: "Dana" } }] });
    fakeAiGateway.reply({ text: "Dana orders every spring." });

    // A message that finds nothing itself, so only the tool brings facts.
    const streamed = await readTurn(await streamTurn(orgA.admin.ctx, id, "Look up our customer"));

    expect(streamed.toolCalls).toEqual(["search_memory"]);
    expect(sentToModel(before)).toContain(ORDERS);
    expect(sentToModel(before)).not.toContain(ROLE);
    expect(sentToModel(before)).not.toContain(DEMO);
    const conversation = JSON.stringify(await getConversation(orgA.admin.ctx, id));
    expect(conversation).toContain("search_memory");
    expect(conversation).not.toContain(ORDERS);
    expect(await tablesHolding(ORDERS)).not.toContain("builder_messages");
    expect(streamed.raw).not.toContain(ORDERS);
    const [read] = await listAccessLog(orgA.admin.ctx);
    expect(read).toMatchObject({
      reader: { kind: "builder", userId: orgA.admin.id },
      factCount: 1,
    });
  });
});

/** Looks the sender up in memory, then drafts a reply that reads what was found. */
const lookupSpec = {
  specVersion: 1,
  id: "customer-replies",
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  steps: [
    { id: "known", type: "tool", action: "memory.lookup", input: { about: "sender" } },
    {
      id: "draft",
      type: "draft",
      role: "fast",
      instructions: "Reply using what we know about the customer.",
      context: ["trigger.message", "known"],
      output: "google-mail.create-draft",
    },
    { id: "approve", type: "approval", channel: "gmail_drafts" },
  ],
  autonomy: { rung: 3 },
};

describe("Try it's memory.lookup", () => {
  it("reads the admin's own view for their page only, and the conversation keeps none of it", async () => {
    const { orgA, own } = await setup();
    const admin = orgA.admin.ctx;
    const { id: workflowId } = await saveWorkflow(admin, { name: "Replies", spec: lookupSpec });
    const { id: conversationId } = await startConversation(admin, { workflowId });
    fakeAiGateway.text("Thanks Dana.");

    const { result } = await tryInConversation(admin, conversationId, own);

    // A run on the admin's own connection acts for them, so Try it shows what they can see.
    expect(JSON.stringify(result)).toContain(ROLE);
    const stored = JSON.stringify(await getConversation(admin, conversationId));
    for (const fact of [ROLE, ORDERS, DEMO]) expect(stored).not.toContain(fact);
    expect(await tablesHolding(ROLE)).not.toContain("builder_messages");
  });
});
