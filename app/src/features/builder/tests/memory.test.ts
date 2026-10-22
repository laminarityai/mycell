// The builder reads memory in the admin's own view (ADR-0023): a context section found by the
// admin's message, and the search_memory tool. A conversation keeps the IDs of what was found,
// never what the facts say, since any admin may open it.
import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, type FixtureOrg } from "@/db/testing/two-org-fixture";
import { backfillConnection } from "@/features/discovery/server";
import { listAccessLog } from "@/features/memory/server";
import type { Ctx } from "@/lib/ctx";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import {
  learnStoredItems,
  scriptLearning,
  type ScriptedExtraction,
} from "@/testing/memory-learning";
import { getConversation, startConversation, streamTurn } from "../server";
import { fundOrg, readTurn } from "./turn-helpers";

beforeEach(resetDatabase);

const DANA = "dana@acme.example";
const ROLE = "Dana Ruiz leads procurement at Acme.";
const DEMO = "Dana Ruiz asked for a demo of the oak range.";
const dana = { ref: "dana", kind: "person" as const, name: "Dana Ruiz", email: DANA };

const role: ScriptedExtraction = {
  objects: [dana],
  facts: [{ about: "dana", statement: ROLE, evidence: "I lead procurement at Acme" }],
};
const demo: ScriptedExtraction = {
  objects: [dana],
  facts: [{ about: "dana", statement: DEMO, evidence: "Could we see a demo of the oak range?" }],
};

async function learnFrom(
  org: FixtureOrg,
  ctx: Ctx,
  address: string,
  text: string,
  learned: ScriptedExtraction,
) {
  const box = await connectMailbox(ctx, address, [
    { from: `Dana Ruiz <${DANA}>`, to: [address], subject: "Oak chairs", text, at: daysAgo(2) },
  ]);
  await backfillConnection(ctx, box.id);
  scriptLearning(learned);
  await learnStoredItems(org.id);
}

// Dana told the admin her role, and asked the member, privately, for a demo.
async function setup() {
  const { orgA } = await seedTwoOrgs();
  await fundOrg(orgA.id);
  await learnFrom(orgA, orgA.admin.ctx, orgA.admin.email, "Hi, I lead procurement at Acme.", role);
  await learnFrom(
    orgA,
    orgA.member.ctx,
    orgA.member.email,
    "Could we see a demo of the oak range?",
    demo,
  );
  return orgA;
}

const lastRequest = () => JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);

describe("the builder's memory context", () => {
  it("holds the facts the admin's message finds, in the admin's own view", async () => {
    const orgA = await setup();
    const { id } = await startConversation(orgA.admin.ctx, {});
    fakeAiGateway.reply({ text: "Noted." });

    await readTurn(await streamTurn(orgA.admin.ctx, id, "Draft replies to Dana Ruiz at Acme"));

    expect(lastRequest()).toContain(ROLE);
    expect(lastRequest()).not.toContain(DEMO);
    const [read] = await listAccessLog(orgA.admin.ctx);
    expect(read).toMatchObject({
      operation: "search",
      reader: { kind: "builder", userId: orgA.admin.id },
      factCount: 1,
    });
  });
});

describe("search_memory", () => {
  it("returns the admin's own view to the model, and the conversation keeps only IDs", async () => {
    const orgA = await setup();
    const { id } = await startConversation(orgA.admin.ctx, {});
    fakeAiGateway.reply({ toolCalls: [{ name: "search_memory", input: { query: "Dana" } }] });
    fakeAiGateway.reply({ text: "Dana leads procurement." });

    // A message that finds nothing itself, so only the tool brings facts.
    const streamed = await readTurn(await streamTurn(orgA.admin.ctx, id, "Look up our customer"));

    expect(streamed.toolCalls).toEqual(["search_memory"]);
    expect(lastRequest()).toContain(ROLE);
    expect(lastRequest()).not.toContain(DEMO);
    const conversation = JSON.stringify(await getConversation(orgA.admin.ctx, id));
    expect(conversation).toContain("search_memory");
    expect(conversation).not.toContain(ROLE);
    expect(await tablesHolding(ROLE)).not.toContain("builder_messages");
    expect(streamed.raw).not.toContain(ROLE);
    const [read] = await listAccessLog(orgA.admin.ctx);
    expect(read).toMatchObject({
      reader: { kind: "builder", userId: orgA.admin.id },
      factCount: 1,
    });
  });
});
