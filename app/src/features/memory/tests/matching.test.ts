import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { listLedger } from "@/features/credits/server";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { readObject, searchMemory } from "../server";
import {
  learnStoredItems,
  meaning,
  scriptLearning,
  withCredits,
  type ScriptedExtraction,
} from "./memory-helpers";

beforeEach(resetDatabase);

const DANA = "dana@acme.example";
const OTHER_DANA = "dana.ruiz@globex.example";
const HANDLES = "Dana Ruiz will handle Acme's renewal.";
const ROLE = "Dana Ruiz leads procurement at Acme.";
const GLOBEX_ROLE = "Dana Ruiz runs finance at Globex.";

const byEmail = (value: string) => ({ key: { kind: "email" as const, value } });

// Org A's member hears about Dana Ruiz from a colleague, by name only, and then from Dana herself.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const colleague = `sam@${orgA.workspaceDomain}`;
  const email = (overrides: Partial<FakeMessageInput>): FakeMessageInput => ({
    from: `Sam <${colleague}>`,
    to: [orgA.member.email],
    subject: "Acme",
    text: "",
    at: daysAgo(3),
    ...overrides,
  });
  const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
    email({ text: "Dana Ruiz from Acme will handle the renewal." }),
  ]);
  await backfillConnection(orgA.member.ctx, mailbox.id);
  scriptLearning(
    {
      objects: [{ ref: "dana", kind: "person", name: "Dana Ruiz" }],
      facts: [{ about: "dana", statement: HANDLES, evidence: "Dana Ruiz from Acme will handle" }],
    },
    1,
    [meaning(0)],
  );
  await learnStoredItems(orgA.id);
  const nameOnly = (await searchMemory(orgA.member.ctx, { text: "Dana Ruiz" })).objects.at(0);
  if (nameOnly === undefined) throw new Error("Dana Ruiz wasn't learned.");

  // Another email arrives and is learned, its model calls scripted by `script`.
  const receive = async (overrides: Partial<FakeMessageInput>, script: () => void) => {
    mailbox.mailbox.add(email({ at: daysAgo(1), ...overrides }));
    await pollConnection(systemCtx(orgA.id), mailbox.id);
    script();
    return learnStoredItems(orgA.id);
  };
  return { ...orgs, mailbox, receive, nameOnly };
}

const fromDana = (address: string, statement: string, evidence: string) => ({
  extraction: {
    objects: [{ ref: "d", kind: "person", name: "Dana Ruiz", email: address }],
    facts: [{ about: "d", statement, evidence }],
  } satisfies ScriptedExtraction,
});

/** The confirmation model's answer: whether the two are the same. */
function confirms(same: boolean) {
  fakeAiGateway.object({ same });
}

async function fastCalls(orgId: string) {
  const usage = (await listLedger(systemCtx(orgId))).filter((e) => e.kind === "usage");
  return usage.filter((entry) => entry.role === "fast").length;
}

describe("matching an object without an exact key", () => {
  it("merges a fuzzy candidate the model confirms", async () => {
    const { orgA, receive, nameOnly } = await setup();
    const { extraction } = fromDana(DANA, ROLE, "I lead procurement at Acme");

    await receive({ from: `Dana Ruiz <${DANA}>`, text: "I lead procurement at Acme." }, () => {
      scriptLearning(extraction, 1, [meaning(7)]);
      confirms(true);
    });

    const dana = await readObject(orgA.member.ctx, byEmail(DANA));
    expect(dana.id).toBe(nameOnly.id);
    expect(dana.keys).toEqual([{ kind: "email", value: DANA }]);
    expect(dana.facts.map((fact) => fact.statement)).toEqual([HANDLES, ROLE]);
    // Extracting each email, and confirming the candidate.
    expect(await fastCalls(orgA.id)).toBe(3);
    const confirmation = fakeAiGateway.requests("language").at(-1);
    expect(JSON.stringify(confirmation?.body)).toContain(HANDLES);
  });

  it("keeps a candidate the model doesn't confirm separate", async () => {
    const { orgA, receive, nameOnly } = await setup();
    const { extraction } = fromDana(DANA, ROLE, "I lead procurement at Acme");

    await receive({ from: `Dana Ruiz <${DANA}>`, text: "I lead procurement at Acme." }, () => {
      scriptLearning(extraction, 1, [meaning(7)]);
      confirms(false);
    });

    const dana = await readObject(orgA.member.ctx, byEmail(DANA));
    expect(dana.id).not.toBe(nameOnly.id);
    expect(dana.facts.map((fact) => fact.statement)).toEqual([ROLE]);
    const named = await readObject(orgA.member.ctx, { id: nameOnly.id });
    expect(named.facts.map((fact) => fact.statement)).toEqual([HANDLES]);
  });

  it("keeps two people with one name apart", async () => {
    const { orgA, receive } = await setup();
    await receive({ from: `Dana Ruiz <${DANA}>`, text: "I lead procurement at Acme." }, () => {
      scriptLearning(fromDana(DANA, ROLE, "I lead procurement at Acme").extraction, 1, [
        meaning(7),
      ]);
      confirms(true);
    });

    await receive({ from: `Dana Ruiz <${OTHER_DANA}>`, text: "I run finance at Globex." }, () => {
      scriptLearning(fromDana(OTHER_DANA, GLOBEX_ROLE, "I run finance at Globex").extraction, 1, [
        meaning(8),
      ]);
      // One candidate: the Dana Ruiz now known by her address.
      confirms(false);
    });

    const acmeDana = await readObject(orgA.member.ctx, byEmail(DANA));
    const globexDana = await readObject(orgA.member.ctx, byEmail(OTHER_DANA));
    expect(globexDana.id).not.toBe(acmeDana.id);
    expect(globexDana.facts.map((fact) => fact.statement)).toEqual([GLOBEX_ROLE]);
    expect(acmeDana.keys).toEqual([{ kind: "email", value: DANA }]);
  });

  it("finds a candidate by what its facts mean, whatever its name", async () => {
    const { orgA, receive } = await setup();
    const deal = (name: string, statement: string, evidence: string, means: number[]) => () => {
      scriptLearning(
        {
          objects: [{ ref: "deal", kind: "deal", name }],
          facts: [{ about: "deal", statement, evidence }],
        },
        1,
        [means],
      );
    };
    await receive(
      { text: "The Acme renewal is worth 40k a year." },
      deal("Acme renewal", "The Acme renewal is worth 40k a year.", "worth 40k a year", meaning(5)),
    );

    await receive({ text: "The Northwind contract closes on Friday." }, () => {
      deal(
        "Northwind contract",
        "The Northwind contract closes on Friday.",
        "closes on Friday",
        meaning(5, 6, 0.1),
      )();
      confirms(true);
    });

    const found = await searchMemory(orgA.member.ctx, { text: "renewal contract" });
    expect(found.objects.filter((object) => object.kind === "deal")).toHaveLength(1);
  });
});

describe("matching across companies", () => {
  it("never matches an object in another company", async () => {
    const { orgA, orgB } = await setup();
    await withCredits(orgB.id);
    const mailbox = await connectMailbox(orgB.member.ctx, orgB.member.email, [
      {
        from: `Dana Ruiz <${DANA}>`,
        to: [orgB.member.email],
        text: "I lead procurement at Acme.",
        at: daysAgo(2),
      },
    ]);
    await backfillConnection(orgB.member.ctx, mailbox.id);
    scriptLearning(fromDana(DANA, ROLE, "I lead procurement at Acme").extraction, 1, [meaning(0)]);

    // Org A knows a Dana Ruiz by name, with a fact meaning the same: org B's Dana matches neither.
    await learnStoredItems(orgB.id);

    const orgBDana = await readObject(orgB.member.ctx, byEmail(DANA));
    expect(orgBDana.facts.map((fact) => fact.statement)).toEqual([ROLE]);
    expect(await fastCalls(orgB.id)).toBe(1);
    expect((await searchMemory(orgA.member.ctx, { text: "Dana Ruiz" })).facts).toHaveLength(1);
  });
});
