// Memory's reads must not grow with the org: a search resolves who is reading once, whatever
// the org's size; checking an item against the exclusions reads only those that could cover it;
// and learning an item reads its connection once a step, then reaches its app through that.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries, type QueryCount } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser, type FixtureOrg } from "@/db/testing/two-org-fixture";
import { queryText, watchQueries } from "@/db/testing/watch-queries";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { addExclusion, markCompanyWideList, readObject, searchMemory } from "../server";
import { classifiedAs, learnStoredItems, scriptLearning, withCredits } from "./memory-helpers";

beforeEach(resetDatabase);

const DANA = "dana@acme.example";
const RENEWAL = "Acme's renewal is due in March.";

// Org A's member has a mailbox memory learned one email from, and the org marked a list.
async function setup() {
  const { orgA } = await seedTwoOrgs();
  await withCredits(orgA.id);
  await markCompanyWideList(orgA.admin.ctx, `all@${orgA.workspaceDomain}`);
  const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, []);
  await backfillConnection(orgA.member.ctx, mailbox.id);
  // An email arrives in the member's mailbox, and discovery stores it.
  const arrives = async (overrides: Partial<FakeMessageInput> = {}) => {
    mailbox.mailbox.add({
      from: `Dana Ruiz <${DANA}>`,
      to: [orgA.member.email],
      subject: "Renewal",
      text: "Our renewal is due in March.",
      at: daysAgo(1),
      ...overrides,
    });
    await pollConnection(systemCtx(orgA.id), mailbox.id);
  };
  await arrives();
  scriptLearning({
    objects: [{ ref: "acme", kind: "company", name: "Acme", domain: "acme.example" }],
    facts: [{ about: "acme", statement: RENEWAL, evidence: "Our renewal is due in March" }],
  });
  expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "learned", objects: 1, facts: 1 }]);
  return { orgA, arrives };
}

// Adds people to the org until it has `size`.
async function growTo(org: FixtureOrg, from: number, size: number) {
  for (let n = from + 1; n <= size; n += 1) {
    await seedUser(org.id, `person-${String(n)}@${org.workspaceDomain}`, "member");
  }
}

// The queries a search and a read make, and the rows they return.
async function readQueries(org: FixtureOrg): Promise<QueryCount[]> {
  const search = await countQueries(async () => {
    const found = await searchMemory(org.member.ctx, { text: "When is the renewal?" });
    expect(found.facts.map((fact) => fact.statement)).toEqual([RENEWAL]);
  });
  const byDomain = { key: { kind: "domain" as const, value: "acme.example" } };
  const read = await countQueries(async () => {
    expect((await readObject(org.member.ctx, byDomain)).facts).toHaveLength(1);
  });
  return [search, read];
}

describe("memory reads' query budget", () => {
  it("makes the same queries and reads the same rows for 2 people as for 10", async () => {
    const { orgA } = await setup();

    const few = await readQueries(orgA);
    await growTo(orgA, 2, 10);
    const many = await readQueries(orgA);

    expect(many).toEqual(few);
  });
});

// The queries that read the connections table while `fn` runs.
async function connectionReads(fn: () => Promise<unknown>): Promise<number> {
  let reads = 0;
  await watchQueries((_client, args) => {
    if (/from "connections"/.test(queryText(args))) reads += 1;
    return undefined;
  }, fn);
  return reads;
}

describe("learning's query budget", () => {
  it("checks an item against 1 exclusion or 20 with the same queries and rows", async () => {
    const { orgA, arrives } = await setup();
    const exclude = async (from: number, to: number) => {
      for (let n = from; n <= to; n += 1) {
        const kind = n % 2 === 0 ? "address" : "domain";
        const value =
          kind === "address" ? `someone-${String(n)}@else.example` : `else-${String(n)}.example`;
        await addExclusion(orgA.admin.ctx, { kind, value });
      }
    };
    // A newsletter: learning decides in one step, checking the exclusions on the way.
    const learnOne = async () => {
      await arrives({ subject: "News", text: "This week's news." });
      classifiedAs("newsletter");
      return countQueries(async () => {
        expect(await learnStoredItems(orgA.id)).toEqual([
          { outcome: "skipped", reason: "not_business" },
        ]);
      });
    };

    await exclude(1, 1);
    const one = await learnOne();
    await exclude(2, 20);
    const twenty = await learnOne();

    expect(twenty).toEqual(one);
  });

  it("reads the connection once a step, however many calls the step makes to its app", async () => {
    const { orgA, arrives } = await setup();
    // A label exclusion makes the first step read the mailbox's labels too.
    await addExclusion(orgA.admin.ctx, { kind: "gmail_label", value: "HR" });

    await arrives({ subject: "News", text: "This week's news.", labelIds: ["INBOX"] });
    classifiedAs("newsletter");
    expect(await connectionReads(() => learnStoredItems(orgA.id))).toBe(1);

    // A business email: two steps, each reading the email again.
    await arrives({ text: "Our renewal moved to April.", labelIds: ["INBOX"] });
    scriptLearning({
      objects: [{ ref: "acme", kind: "company", name: "Acme", domain: "acme.example" }],
      facts: [{ about: "acme", statement: "Acme's renewal moved to April.", evidence: "moved" }],
    });
    expect(await connectionReads(() => learnStoredItems(orgA.id))).toBe(2);
  });
});
