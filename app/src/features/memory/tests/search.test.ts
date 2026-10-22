import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { listLedger } from "@/features/credits/server";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { searchMemory } from "../server";
import { learnStoredItems, meaning, scriptLearning, withCredits } from "./memory-helpers";

beforeEach(resetDatabase);

const DANA = "dana@acme.example";
const ROLE = "Dana Ruiz leads procurement at Acme.";
const RENEWAL = "Acme's renewal is due in March.";
const EXTENSION = "Acme agreed to a three-year extension.";
const OFFICE = "Acme's office moved to Leeds.";
const PRICE = "Acme's renewal price rises by 5%.";

// What each fact means, as its embedding says: the renewal and the extension mean nearly the
// same; the role and the office mean nothing like either.
const ROLE_MEANS = meaning(0);
const RENEWAL_MEANS = meaning(1);
const EXTENSION_MEANS = meaning(1, 2, 0.2);
const OFFICE_MEANS = meaning(3);
const PRICE_MEANS = meaning(1, 4, 0.1);

const dana = { ref: "dana", kind: "person" as const, name: "Dana Ruiz", email: DANA };
const acme = { ref: "acme", kind: "company" as const, name: "Acme", domain: "acme.example" };

// Dana at Acme writes twice to org A's member, copying its admin; Lee is on neither email.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const lee = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
  const danaEmail = (overrides: Partial<FakeMessageInput>): FakeMessageInput => ({
    from: `Dana Ruiz <${DANA}>`,
    to: [orgA.member.email],
    cc: [orgA.admin.email],
    subject: "Renewal",
    text: "",
    at: daysAgo(2),
    ...overrides,
  });
  const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, []);
  const adminBox = await connectMailbox(orgA.admin.ctx, orgA.admin.email, []);
  await backfillConnection(orgA.member.ctx, mailbox.id);
  await backfillConnection(orgA.admin.ctx, adminBox.id);
  // Delivers a copy of the email to the member's mailbox and the admin's.
  const deliver = async (message: FakeMessageInput, messageId: string) => {
    for (const box of [mailbox, adminBox]) {
      box.mailbox.add({ ...message, headers: { "Message-ID": `<${messageId}@acme.example>` } });
      await pollConnection(systemCtx(orgA.id), box.id);
    }
  };
  await deliver(
    danaEmail({ text: "I lead procurement at Acme. Our renewal is due in March." }),
    "renewal-1",
  );
  scriptLearning(
    {
      objects: [dana, acme],
      facts: [
        {
          about: "dana",
          statement: ROLE,
          evidence: "I lead procurement at Acme",
          object: "acme",
        },
        { about: "acme", statement: RENEWAL, evidence: "Our renewal is due in March" },
      ],
    },
    2,
    [ROLE_MEANS, RENEWAL_MEANS],
  );
  await learnStoredItems(orgA.id);

  await deliver(
    danaEmail({
      text: "We agreed to a three-year extension. Our office moved to Leeds.",
      at: daysAgo(1),
    }),
    "renewal-2",
  );
  scriptLearning(
    {
      objects: [acme],
      facts: [
        { about: "acme", statement: EXTENSION, evidence: "We agreed to a three-year extension" },
        { about: "acme", statement: OFFICE, evidence: "Our office moved to Leeds" },
      ],
    },
    2,
    [EXTENSION_MEANS, OFFICE_MEANS],
  );
  await learnStoredItems(orgA.id);
  return { ...orgs, lee, mailbox, danaEmail };
}

const statements = (result: { facts: { statement: string }[] }) =>
  result.facts.map((fact) => fact.statement);

describe("searching memory by text", () => {
  it("finds a fact by keyword, and the facts that mean the same", async () => {
    const { orgA } = await setup();

    const result = await searchMemory(orgA.member.ctx, { text: "When are renewals?" });

    expect(statements(result)).toEqual([RENEWAL, EXTENSION]);
    expect(result.objects.map((object) => object.name)).toEqual(["Acme"]);
    expect(result.facts[0]).toMatchObject({
      subject: { kind: "company", name: "Acme" },
      // The member's copy, and the admin's of the same email.
      sources: [{ app: "gmail" }, { app: "gmail" }],
    });
  });
});

describe("searching memory by key", () => {
  it("finds a person by email address and a company by domain, with their facts first", async () => {
    const { orgA } = await setup();

    const byEmail = await searchMemory(orgA.member.ctx, { key: { kind: "email", value: DANA } });
    expect(byEmail.objects[0]).toMatchObject({
      name: "Dana Ruiz",
      keys: [{ kind: "email", value: DANA }],
    });
    expect(statements(byEmail)).toEqual([ROLE]);

    const byDomain = await searchMemory(orgA.member.ctx, {
      key: { kind: "domain", value: "ACME.example" },
    });
    expect(byDomain.objects.map((object) => object.name)).toEqual(["Acme", "Dana Ruiz"]);
    // Facts about Acme, newest first (the second email's two at once), then the fact linking
    // Dana to it.
    const found = statements(byDomain);
    expect(found.slice(0, 2).toSorted()).toEqual([EXTENSION, OFFICE].toSorted());
    expect(found.slice(2)).toEqual([RENEWAL, ROLE]);
  });

  it("finds an object by an email address or domain in the text", async () => {
    const { orgA } = await setup();

    const result = await searchMemory(orgA.member.ctx, { text: `What do we know about ${DANA}?` });

    expect(result.objects[0]?.name).toBe("Dana Ruiz");
    expect(statements(result)[0]).toBe(ROLE);
  });
});

describe("what a search shows", () => {
  it("never includes facts the caller can't see", async () => {
    const { orgA, lee, mailbox, danaEmail } = await setup();
    // To the member alone: the admin isn't on it.
    mailbox.mailbox.add(
      danaEmail({ text: "Our renewal price rises by 5%.", cc: [], at: daysAgo(0) }),
    );
    await pollConnection(systemCtx(orgA.id), mailbox.id);
    scriptLearning(
      {
        objects: [acme],
        facts: [{ about: "acme", statement: PRICE, evidence: "Our renewal price rises by 5%" }],
      },
      1,
      [PRICE_MEANS],
    );
    await learnStoredItems(orgA.id);

    const renewal = { text: "renewal" };
    expect(statements(await searchMemory(orgA.member.ctx, renewal))).toEqual([
      PRICE,
      RENEWAL,
      EXTENSION,
    ]);
    expect(statements(await searchMemory(orgA.admin.ctx, renewal))).toEqual([RENEWAL, EXTENSION]);
    const acmeByDomain = { key: { kind: "domain" as const, value: "acme.example" } };
    expect(statements(await searchMemory(orgA.admin.ctx, acmeByDomain))).not.toContain(PRICE);
    for (const ctx of [lee.ctx, systemCtx(orgA.id)]) {
      expect(await searchMemory(ctx, renewal)).toEqual({ objects: [], facts: [] });
      expect(await searchMemory(ctx, acmeByDomain)).toEqual({ objects: [], facts: [] });
    }
  });

  it("makes no model call", async () => {
    const { orgA } = await setup();
    const ledger = await listLedger(systemCtx(orgA.id));
    const requests = fakeAiGateway.requests().length;

    await searchMemory(orgA.member.ctx, { text: "renewal" });
    await searchMemory(orgA.member.ctx, { key: { kind: "email", value: DANA } });

    expect(await listLedger(systemCtx(orgA.id))).toEqual(ledger);
    expect(fakeAiGateway.requests()).toHaveLength(requests);
  });

  it("returns at most the limit", async () => {
    const { orgA } = await setup();

    const result = await searchMemory(orgA.member.ctx, { text: "Acme renewal", limit: 1 });

    expect(statements(result)).toEqual([RENEWAL]);
  });
});

describe("searching a busy org's memory", () => {
  it("finds the caller's own fact though many newer ones they can't see match too", async () => {
    const { orgA } = await seedTwoOrgs();
    await withCredits(orgA.id);
    const client = { ref: "client", kind: "company" as const, name: "Client Co" };
    const own = "Client Co's renewal is due in June.";
    // The member's own email about Client Co's renewal.
    const memberBox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      {
        from: "pat@client.example",
        to: [orgA.member.email],
        text: "Our renewal at client.example is due in June.",
        at: daysAgo(10),
      },
    ]);
    await backfillConnection(orgA.member.ctx, memberBox.id);
    scriptLearning(
      {
        objects: [{ ...client, domain: "client.example" }],
        facts: [
          { about: "client", statement: own, evidence: "Our renewal at client.example is due" },
        ],
      },
      1,
      [meaning(10)],
    );
    await learnStoredItems(orgA.id);
    // Then 120 newer facts about Client Co's renewal, from the admin's private mail.
    const notes = Array.from({ length: 120 }, (_, i) => `Renewal note ${String(i)} is filed.`);
    const adminBox = await connectMailbox(orgA.admin.ctx, orgA.admin.email, [
      {
        from: "pat@client.example",
        to: [orgA.admin.email],
        text: `About client.example. ${notes.join(" ")}`,
        at: daysAgo(1),
      },
    ]);
    await backfillConnection(orgA.admin.ctx, adminBox.id);
    scriptLearning(
      {
        objects: [{ ...client, domain: "client.example" }],
        facts: notes.map((note, i) => ({
          about: "client",
          statement: `Client Co renewal note ${String(i)} exists.`,
          evidence: note.slice(0, -1),
        })),
      },
      notes.length,
      notes.map((_, i) => meaning(100 + i)),
    );
    await learnStoredItems(orgA.id);
    const renewal = { text: "renewal" };
    // The admin's own notes fill a search's default 20.
    expect((await searchMemory(orgA.admin.ctx, renewal)).facts).toHaveLength(20);

    expect(statements(await searchMemory(orgA.member.ctx, renewal))).toEqual([own]);
    const byDomain = { key: { kind: "domain" as const, value: "client.example" } };
    expect(statements(await searchMemory(orgA.member.ctx, byDomain))).toEqual([own]);
  });
});
