import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { disconnect } from "@/features/connections/server";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { readObject, searchMemory } from "../server";
import {
  learnStoredItems,
  meaning,
  scriptDocLearning,
  scriptLearning,
  withCredits,
} from "./memory-helpers";

beforeEach(resetDatabase);

const DANA = "dana@acme.example";
const MARCH = "Acme's renewal is due in March.";
const SEATS = "Acme has 40 seats.";
const MAY = "Acme's renewal has moved to May.";
const MOVED_ON = daysAgo(2).toISOString().slice(0, 10);
const JUNE = "Acme's renewal is now in June.";

const acme = { ref: "acme", kind: "company" as const, name: "Acme", domain: "acme.example" };
const byDomain = { key: { kind: "domain" as const, value: "acme.example" } };

// Dana at Acme writes to org A's member, copying its admin, that the renewal is due in March;
// later she writes to the admin alone that it has moved to May.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const email = (overrides: Partial<FakeMessageInput>): FakeMessageInput => ({
    from: `Dana Ruiz <${DANA}>`,
    to: [orgA.member.email],
    cc: [orgA.admin.email],
    subject: "Renewal",
    text: "",
    at: daysAgo(10),
    ...overrides,
  });
  const march = email({ text: "Our renewal at acme.example is due in March. We have 40 seats." });
  const may = email({
    to: [orgA.admin.email],
    cc: [],
    text: "Our renewal at acme.example has moved to May.",
    at: daysAgo(2),
  });
  const scriptMarch = () => {
    scriptLearning(
      {
        objects: [acme],
        facts: [
          {
            about: "acme",
            statement: MARCH,
            evidence: "Our renewal at acme.example is due in March",
            predicate: "renewal_date",
            value: "March",
          },
          {
            about: "acme",
            statement: SEATS,
            evidence: "We have 40 seats",
            predicate: "seats",
            value: "40",
          },
        ],
      },
      2,
      [meaning(1), meaning(3)],
    );
  };
  const scriptMay = () => {
    scriptLearning(
      {
        objects: [acme],
        facts: [
          {
            about: "acme",
            statement: MAY,
            evidence: "Our renewal at acme.example has moved to May",
            predicate: "renewal_date",
            value: "May",
            validFrom: MOVED_ON,
          },
        ],
      },
      1,
      [meaning(1, 2, 0.1)],
    );
  };
  const memberBox = await connectMailbox(orgA.member.ctx, orgA.member.email, []);
  const adminBox = await connectMailbox(orgA.admin.ctx, orgA.admin.email, []);
  // Delivers the email to the mailbox and learns it.
  const learn = async (box: typeof memberBox, message: FakeMessageInput, script: () => void) => {
    box.mailbox.add(message);
    await pollConnection(systemCtx(orgA.id), box.id);
    script();
    return learnStoredItems(orgA.id);
  };
  await backfillConnection(orgA.member.ctx, memberBox.id);
  await backfillConnection(orgA.admin.ctx, adminBox.id);
  return {
    ...orgs,
    memberBox,
    adminBox,
    learnMarch: () => learn(memberBox, march, scriptMarch),
    learnMay: () => learn(adminBox, may, scriptMay),
    // A day after May, to the member, copying the admin: the renewal is now in June.
    learnJune: () =>
      learn(
        memberBox,
        email({ text: "Our renewal at acme.example is now in June.", at: daysAgo(1) }),
        () => {
          scriptLearning(
            {
              objects: [acme],
              facts: [
                {
                  about: "acme",
                  statement: JUNE,
                  evidence: "Our renewal at acme.example is now in June",
                  predicate: "renewal_date",
                  value: "June",
                },
              ],
            },
            1,
            [meaning(1, 2, 0.2)],
          );
        },
      ),
  };
}

// Sorted: facts one email states are recorded at the same time.
const statements = (facts: { statement: string }[]) => facts.map((fact) => fact.statement).sort();

describe("a fact that changes", () => {
  it("supersedes the older fact, which stays as history", async () => {
    const { orgA, learnMarch, learnMay } = await setup();
    await learnMarch();

    await learnMay();

    const seen = await readObject(orgA.admin.ctx, byDomain);
    expect(statements(seen.facts)).toEqual([SEATS, MAY]);
    const may = seen.facts.find((fact) => fact.statement === MAY);
    expect(seen.history).toEqual([
      expect.objectContaining({
        statement: MARCH,
        supersededBy: may?.id,
        validUntil: new Date(`${MOVED_ON}T00:00:00Z`),
      }),
    ]);
    expect(seen.history[0]?.supersededAt).toBeInstanceOf(Date);
    const found = await searchMemory(orgA.admin.ctx, { text: "renewal" });
    expect(statements(found.facts)).toEqual([MAY]);
  });

  it("keeps the newer fact current when the older one is learned after it", async () => {
    const { orgA, learnMarch, learnMay } = await setup();
    await learnMay();

    await learnMarch();

    const seen = await readObject(orgA.admin.ctx, byDomain);
    expect(statements(seen.facts)).toEqual([SEATS, MAY]);
    expect(statements(seen.history)).toEqual([MARCH]);
  });

  it("shows each person the newest fact they can see", async () => {
    const { orgA, learnMarch, learnMay } = await setup();
    await learnMarch();

    await learnMay();

    // The member isn't on the email that moved it.
    const seen = await readObject(orgA.member.ctx, byDomain);
    expect(statements(seen.facts)).toEqual([SEATS, MARCH]);
    expect(seen.facts.find((fact) => fact.statement === MARCH)?.validUntil).toBeNull();
    expect(seen.history).toEqual([]);
    const found = await searchMemory(orgA.member.ctx, { text: "renewal" });
    expect(statements(found.facts)).toEqual([MARCH]);
  });

  it("makes the older fact current again when the newer one's source goes", async () => {
    const { orgA, adminBox, learnMarch, learnMay } = await setup();
    await learnMarch();
    await learnMay();

    await disconnect(orgA.admin.ctx, adminBox.id);

    const seen = await readObject(orgA.admin.ctx, byDomain);
    expect(statements(seen.facts)).toEqual([SEATS, MARCH]);
    expect(seen.history).toEqual([]);
    expect(seen.facts.find((fact) => fact.statement === MARCH)?.validUntil).toBeNull();
  });

  it("keeps the history whole when a fact in the middle of it goes", async () => {
    const { orgA, adminBox, learnMarch, learnMay, learnJune } = await setup();
    await learnMarch();
    await learnMay();
    await learnJune();

    await disconnect(orgA.admin.ctx, adminBox.id);

    const seen = await readObject(orgA.admin.ctx, byDomain);
    expect(statements(seen.facts)).toEqual([SEATS, JUNE]);
    const june = seen.facts.find((fact) => fact.statement === JUNE);
    expect(seen.history).toEqual([
      expect.objectContaining({ statement: MARCH, supersededBy: june?.id, validUntil: null }),
    ]);
  });

  it("supersedes a fact from an email with a newer one from a Drive doc", async () => {
    const { orgA, adminBox, learnMarch } = await setup();
    await learnMarch();
    // The admin's account notes, shared with the company.
    adminBox.drive.add({
      name: "Acme account notes",
      mimeType: "application/vnd.google-apps.document",
      text: "Acme (acme.example): the renewal has moved to May.",
      at: daysAgo(1),
      sharedWith: [{ type: "domain", domain: orgA.workspaceDomain }],
    });
    await pollConnection(systemCtx(orgA.id), adminBox.id);
    scriptDocLearning(
      {
        objects: [acme],
        facts: [
          {
            about: "acme",
            statement: MAY,
            evidence: "the renewal has moved to May",
            predicate: "renewal_date",
            value: "May",
          },
        ],
      },
      1,
      [meaning(1, 2, 0.1)],
    );

    await learnStoredItems(orgA.id);

    // Company-wide, so the member sees it replace what their email said.
    const seen = await readObject(orgA.member.ctx, byDomain);
    expect(statements(seen.facts)).toEqual([SEATS, MAY]);
    expect(statements(seen.history)).toEqual([MARCH]);
    expect(seen.facts.find((fact) => fact.statement === MAY)?.sources[0]?.app).toBe("drive");
  });
});
