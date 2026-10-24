// What Ask Mycel's memory tests learn first: Dana at Acme tells the admin her role privately,
// asks the member for a demo privately, and writes to the company's sales inbox (an org
// connection) about her orders, which is company-wide.
import { seedTwoOrgs, type FixtureOrg } from "@/db/testing/two-org-fixture";
import type { ConnectionKind } from "@/features/connections/types";
import { backfillConnection } from "@/features/discovery/server";
import { startMemory } from "@/features/memory/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import {
  learnStoredItems,
  scriptLearning,
  type ScriptedExtraction,
} from "@/testing/memory-learning";
import { fundOrg } from "@/testing/streamed-turn";

export const DANA = "dana@acme.example";
export const ROLE = "Dana Ruiz leads procurement at Acme.";
export const DEMO = "Dana Ruiz asked for a demo of the oak range.";
export const ORDERS = "Dana Ruiz orders oak chairs every spring.";
export const dana = { ref: "dana", kind: "person" as const, name: "Dana Ruiz", email: DANA };

export const learned = (statement: string, evidence: string): ScriptedExtraction => ({
  objects: [dana],
  facts: [{ about: "dana", statement, evidence }],
});

/** Connects `address`'s mailbox holding `email`, and learns `learning` from it. */
export async function learnFrom(
  org: FixtureOrg,
  ctx: Ctx,
  address: string,
  email: FakeMessageInput,
  learning: ScriptedExtraction,
  kind: ConnectionKind = "member",
) {
  const box = await connectMailbox(ctx, address, [email], kind);
  await backfillConnection(ctx, box.id);
  scriptLearning(learning);
  await learnStoredItems(org.id);
  const sourceRef = box.mailbox.list(new URLSearchParams()).messages?.at(0)?.id ?? "";
  return { connectionId: box.id, sourceRef };
}

const fromDana = (to: string, text: string): FakeMessageInput => ({
  from: `Dana Ruiz <${DANA}>`,
  to: [to],
  subject: "Oak chairs",
  text,
  at: daysAgo(2),
});

export async function setupMemory() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await fundOrg(orgA.id);
  // Memory learns nothing until an admin starts it.
  await startMemory(systemCtx(orgA.id), { monthlyBudget: 1000 });
  const { admin, member } = orgA;
  const lead = "I lead procurement at Acme";
  const adminBox = await learnFrom(
    orgA,
    admin.ctx,
    admin.email,
    fromDana(admin.email, `Hi, ${lead}.`),
    learned(ROLE, lead),
  );
  const ask = "Could we see a demo of the oak range?";
  const memberBox = await learnFrom(
    orgA,
    member.ctx,
    member.email,
    fromDana(member.email, ask),
    learned(DEMO, ask),
  );
  const spring = "We order oak chairs every spring";
  const sales = `sales@${orgA.workspaceDomain}`;
  await learnFrom(
    orgA,
    admin.ctx,
    sales,
    fromDana(sales, `${spring}.`),
    learned(ORDERS, spring),
    "org",
  );
  return { ...orgs, adminBox, memberBox };
}

/** Everything sent to the model from request `from` on: a turn's every step together. */
export const sentToModel = (from: number) =>
  JSON.stringify(fakeAiGateway.requests("language").slice(from));
