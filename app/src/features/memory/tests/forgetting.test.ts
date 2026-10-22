import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import { decryptForOrg, encryptForOrg } from "@/features/key-store/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { connectMailbox } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { fakeInngest } from "@/testing/fake-inngest";
import {
  forgetPerson,
  forgetPersonAgain,
  getMemorySettings,
  readObject,
  searchMemory,
} from "../server";
import { learnStoredItems, scriptLearning, withCredits } from "./memory-helpers";

beforeEach(resetDatabase);

const SAM = "sam@client.example";
const DANA = "dana@globex.example";
const SAM_ROLE = "Sam Lee runs purchasing at Client Co.";
const RENEWAL = "Client Co renews its contract in June.";
const DANA_ROLE = "Dana Ruiz runs sales at Globex.";
const INTRO = "Dana Ruiz introduced Sam Lee to the team.";
const byEmail = (value: string) => ({ key: { kind: "email" as const, value } });

const fromSam = {
  from: `Sam Lee <${SAM}>`,
  text: "Hi, I run purchasing at Client Co. Our contract renews in June.",
};
const fromDana = {
  from: `Dana Ruiz <${DANA}>`,
  cc: [SAM],
  text: "Hello, I run sales at Globex. I introduced Sam to the team.",
};

function scriptSam() {
  scriptLearning({
    objects: [
      { ref: "sam", kind: "person", name: "Sam Lee", email: SAM },
      { ref: "client", kind: "company", name: "Client Co", domain: "client.example" },
    ],
    facts: [
      {
        about: "sam",
        statement: SAM_ROLE,
        evidence: "I run purchasing at Client Co",
        object: "client",
      },
      { about: "client", statement: RENEWAL, evidence: "Our contract renews in June" },
    ],
  });
}

// Dana's email names Sam too: a fact linking Dana to Sam.
function scriptDana() {
  scriptLearning({
    objects: [
      { ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA },
      { ref: "sam", kind: "person", name: "Sam Lee", email: SAM },
    ],
    facts: [
      { about: "dana", statement: DANA_ROLE, evidence: "I run sales at Globex" },
      { about: "dana", statement: INTRO, evidence: "I introduced Sam to the team", object: "sam" },
    ],
  });
}

// Org A's member has a mailbox, memory has started, and it learned from Sam and Dana.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, []);
  await backfillConnection(orgA.member.ctx, mailbox.id);
  const arrives = async (input: Omit<FakeMessageInput, "at">) => {
    mailbox.mailbox.add({ to: [orgA.member.email], at: new Date(), ...input });
    await pollConnection(systemCtx(orgA.id), mailbox.id);
    return learnStoredItems(orgA.id);
  };
  scriptSam();
  expect(await arrives(fromSam)).toEqual([{ outcome: "learned", objects: 2, facts: 2 }]);
  scriptDana();
  expect(await arrives(fromDana)).toEqual([{ outcome: "learned", objects: 2, facts: 2 }]);
  return { ...orgs, arrives };
}

const statements = async (ctx: Parameters<typeof readObject>[0], email: string) =>
  (await readObject(ctx, byEmail(email))).facts.map((fact) => fact.statement);

describe("forgetting a person", () => {
  it("deletes their object, every fact about them or linking to them, and says how many", async () => {
    const { orgA } = await setup();

    expect(await forgetPerson(orgA.admin.ctx, { email: ` ${SAM.toUpperCase()} ` })).toEqual({
      facts: 2,
    });

    await expect(readObject(orgA.member.ctx, byEmail(SAM))).rejects.toThrow(NotFoundError);
    expect(await statements(orgA.member.ctx, DANA)).toEqual([DANA_ROLE]);
    const found = await searchMemory(orgA.member.ctx, { text: "Client Co" });
    expect(found.facts.map((fact) => fact.statement)).toEqual([RENEWAL]);
    expect(found.facts[0]?.linkedObject).toBeNull();
    // What memory holds names Sam nowhere: no object, key or fact.
    const holding = await tablesHolding(SAM);
    for (const table of ["memory_objects", "object_keys", "facts", "memory_do_not_learn"]) {
      expect(holding).not.toContain(table);
    }
    expect((await getMemorySettings(orgA.admin.ctx)).forgottenPeople).toBe(1);
  });

  it("never learns from their new mail, and never rebuilds them from anyone else's", async () => {
    const { orgA, arrives } = await setup();
    await forgetPerson(orgA.admin.ctx, { email: SAM });

    const requests = fakeAiGateway.requests().length;
    expect(await arrives({ ...fromSam, from: SAM.toUpperCase() })).toEqual([
      { outcome: "skipped", reason: "forgotten" },
    ]);
    expect(fakeAiGateway.requests()).toHaveLength(requests);

    // Dana's new email names Sam again: what it says about Dana is learned, and Sam isn't.
    scriptLearning(
      {
        objects: [
          { ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA },
          { ref: "sam", kind: "person", name: "Sam Lee", email: SAM },
        ],
        facts: [
          { about: "dana", statement: "Dana Ruiz moved to Leeds.", evidence: "I moved to Leeds" },
          { about: "sam", statement: SAM_ROLE, evidence: "Sam runs purchasing" },
          { about: "dana", statement: INTRO, evidence: "I introduced Sam", object: "sam" },
        ],
      },
      1,
    );
    expect(
      await arrives({
        ...fromDana,
        text: "I moved to Leeds. Sam runs purchasing. I introduced Sam.",
      }),
    ).toEqual([{ outcome: "learned", objects: 1, facts: 1 }]);
    await expect(readObject(orgA.member.ctx, byEmail(SAM))).rejects.toThrow(NotFoundError);
    expect((await statements(orgA.member.ctx, DANA)).sort()).toEqual(
      ["Dana Ruiz moved to Leeds.", DANA_ROLE].sort(),
    );
  });

  it("puts someone memory never knew on the list, holding no trace of their address", async () => {
    const { orgA } = await seedTwoOrgs();
    const address = "never.seen@elsewhere.example";

    expect(await forgetPerson(orgA.admin.ctx, { email: address })).toEqual({ facts: 0 });
    expect(await forgetPerson(orgA.admin.ctx, { email: address })).toEqual({ facts: 0 });

    expect(await tablesHolding(address)).toEqual([]);
    expect(await tablesHolding("never.seen")).toEqual([]);
    expect((await getMemorySettings(orgA.admin.ctx)).forgottenPeople).toBe(1);
  });

  it("sweeps again once learning in progress is done, without the address in the event", async () => {
    const { orgA } = await setup();

    await forgetPerson(orgA.admin.ctx, { email: SAM });

    const sent = fakeInngest.sent("memory/person.forgotten");
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0]?.data)).not.toContain(SAM);
    const encrypted = String(sent[0]?.data.address);
    expect(await decryptForOrg(systemCtx(orgA.id), encrypted)).toBe(SAM);
    expect(await forgetPersonAgain(systemCtx(orgA.id), encrypted)).toEqual({ facts: 0 });
  });

  it("the sweep deletes whatever learning stored about the person meanwhile", async () => {
    const { orgA } = await setup();
    const encrypted = await encryptForOrg(systemCtx(orgA.id), SAM);

    expect(await forgetPersonAgain(systemCtx(orgA.id), encrypted)).toEqual({ facts: 2 });

    await expect(readObject(orgA.member.ctx, byEmail(SAM))).rejects.toThrow(NotFoundError);
    await expect(forgetPersonAgain(orgA.admin.ctx, encrypted)).rejects.toThrow(ForbiddenError);
  });

  it("is for admins only, and needs an email address", async () => {
    const { orgA } = await setup();

    await expect(forgetPerson(orgA.member.ctx, { email: SAM })).rejects.toThrow(ForbiddenError);
    await expect(forgetPerson(systemCtx(orgA.id), { email: SAM })).rejects.toThrow(ForbiddenError);
    await expect(forgetPerson(orgA.admin.ctx, { email: "Sam Lee" })).rejects.toThrow(
      ValidationError,
    );
    expect(await statements(orgA.member.ctx, SAM)).toEqual([SAM_ROLE]);
  });
});
