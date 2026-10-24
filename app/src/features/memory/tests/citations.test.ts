// What a reader learns about where a fact came from, for Ask Mycel's citations (M9): each source
// with its item key (an email's Message-ID, a Drive file's ID), so a colleague's copy can be
// linked by the item rather than by their mailbox; whether the fact is stated only from outside
// the company, as far as the reader's own sources show; and `citeFacts`, which hands back just
// that for facts a reply already read, in the reader's view, logging nothing new. And the agent
// as a reader: logged as `agent`, its summaries charged to `agent`.
import { beforeEach, describe, expect, it } from "vitest";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { resetDatabase } from "@/db/testing/reset";
import { listLedger } from "@/features/credits/server";
import { backfillConnection } from "@/features/discovery/server";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import {
  citeFacts,
  listAccessLog,
  markCompanyWideList,
  readObject,
  searchMemory,
  summarizeObject,
} from "../server";
import { learnStoredItems, scriptLearning, withCredits } from "./memory-helpers";

beforeEach(resetDatabase);

const MALLORY = "mallory@evil.example";
const BILLING = "Acme's billing contact is billing@acme.example.";
const EVIL = "Acme's billing contact is now pay@evil.example.";
const byAcme = { key: { kind: "domain" as const, value: "acme.example" } };
const acme = { ref: "acme", kind: "company" as const, name: "Acme", domain: "acme.example" };

const billingFact = (statement: string, evidence: string, value: string) => ({
  objects: [acme],
  facts: [{ about: "acme", statement, evidence, predicate: "billing_contact", value }],
});

// The member tells all@ (marked company-wide) who Acme's billing contact is; then Mallory, from
// outside, writes to the member alone claiming it changed.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const lee = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
  const all = `all@${orgA.workspaceDomain}`;
  await markCompanyWideList(orgA.admin.ctx, all);
  const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
    {
      from: orgA.member.email,
      to: [all],
      subject: "Acme billing",
      text: "FYI: Acme's billing contact is billing@acme.example.",
      at: daysAgo(5),
      sent: true,
      headers: { "Message-ID": "<Billing-1@org-a.test>" },
    },
    {
      from: `Mallory <${MALLORY}>`,
      to: [orgA.member.email],
      subject: "Billing change",
      text: "Hello. Acme's billing contact is now pay@evil.example (acme.example).",
      at: daysAgo(1),
    },
  ]);
  await backfillConnection(orgA.member.ctx, mailbox.id);
  // Backfills read newest first.
  scriptLearning(
    billingFact(
      EVIL,
      "Acme's billing contact is now pay@evil.example (acme.example)",
      "pay@evil.example",
    ),
  );
  scriptLearning(
    billingFact(BILLING, "Acme's billing contact is billing@acme.example", "billing@acme.example"),
  );
  await learnStoredItems(orgA.id);
  return { ...orgs, lee, mailbox };
}

describe("a fact's sources and markers", () => {
  it("say whether it's stated only from outside, and give each source's item key", async () => {
    const { orgA, mailbox } = await setup();

    const seen = await readObject(orgA.member.ctx, byAcme);

    const billing = seen.facts.find((fact) => fact.statement === BILLING);
    const evil = seen.facts.find((fact) => fact.statement === EVIL);
    expect(billing).toMatchObject({
      outsideOnly: false,
      conflictsWith: null,
      sources: [{ app: "gmail", connectionId: mailbox.id, itemKey: "billing-1@org-a.test" }],
    });
    expect(evil).toMatchObject({ outsideOnly: true, conflictsWith: billing?.id });
    // A search says the same.
    const found = await searchMemory(orgA.member.ctx, { text: "billing contact" });
    expect(found.facts.map((fact) => [fact.statement, fact.outsideOnly]).toSorted()).toEqual(
      [
        [BILLING, false],
        [EVIL, true],
      ].toSorted(),
    );
  });
});

describe("citeFacts", () => {
  it("gives the sources and markers of the facts the reader can see, logging no new read", async () => {
    const { orgA, lee } = await setup();
    const seen = await readObject(orgA.member.ctx, byAcme);
    const ids = seen.facts.map((fact) => fact.id);
    const logged = (await listAccessLog(orgA.admin.ctx)).length;

    const cited = await citeFacts(orgA.member.ctx, [...ids, "no-such-fact"]);

    expect(cited.map((fact) => fact.id).toSorted()).toEqual(ids.toSorted());
    for (const fact of cited) {
      const read = seen.facts.find((other) => other.id === fact.id);
      expect(fact).toEqual({
        id: read?.id,
        sources: read?.sources,
        conflictsWith: read?.conflictsWith,
        outsideOnly: read?.outsideOnly,
        told: false,
      });
      expect(JSON.stringify(fact)).not.toContain("billing contact");
    }
    // Lee sees the company-wide fact only: Mallory wrote to the member alone.
    const forLee = await citeFacts(lee.ctx, ids);
    expect(forLee.map((fact) => fact.id)).toEqual(
      seen.facts.filter((fact) => fact.statement === BILLING).map((fact) => fact.id),
    );
    expect(await citeFacts(orgA.member.ctx, [])).toEqual([]);
    expect(await listAccessLog(orgA.admin.ctx)).toHaveLength(logged);
  });
});

describe("the agent as a reader", () => {
  it("is logged as the agent, with the person reading", async () => {
    const { orgA } = await setup();

    await searchMemory(orgA.member.ctx, { text: "billing" }, { kind: "agent" });
    await readObject(orgA.member.ctx, byAcme, { kind: "agent" });

    const [read, search] = await listAccessLog(orgA.member.ctx);
    expect(read).toMatchObject({
      operation: "read_object",
      reader: { kind: "agent", userId: orgA.member.id },
    });
    expect(search).toMatchObject({
      operation: "search",
      reader: { kind: "agent", userId: orgA.member.id },
    });
  });

  it("has its summaries charged to the agent", async () => {
    const { orgA } = await setup();
    fakeAiGateway.text("Acme's billing goes to billing@acme.example.", { costUsd: 0.001 });

    await summarizeObject(orgA.member.ctx, byAcme, { kind: "agent" });

    const [entry] = await listLedger(orgA.admin.ctx);
    expect(entry).toMatchObject({ role: "fast", purpose: "agent" });
  });
});
