// A told fact is its teller's own (ADR-0023): visible only to them, in their searches, reads,
// citations and the workflows that read as them, never to a colleague, an admin or an
// org-credential view. Its timeline is the teller's own too: a newer note replaces their older
// one on the same point, kept as history, and never touches what sources said or a colleague's
// notes. It goes with its teller's membership, and when the person it's about is forgotten.
import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { removeUser } from "@/features/orgs/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { daysAgo } from "@/testing/connect-helpers";
import {
  citeFacts,
  forgetPerson,
  readObject,
  searchCompanyWideMemory,
  searchMemory,
  tellFact,
} from "../server";
import type { TellFactInput } from "../types";
import { scriptTelling } from "./memory-helpers";
import {
  byEmail,
  learnInInbox,
  PRIYA,
  PRIYA_NOTE,
  SALES_FACT,
  setupTold,
  TOM_NOTE,
} from "./told-setup";

beforeEach(resetDatabase);

const RENEWAL = { predicate: "renewal_contact", value: "someone" };

async function tell(ctx: Ctx, input: TellFactInput, predicate?: string): Promise<string> {
  scriptTelling(predicate === undefined ? {} : { ...RENEWAL, predicate });
  const told = await tellFact(ctx, input);
  if (!told.saved) throw new Error(`Not saved: ${told.reason}`);
  return told.fact.id;
}

const searched = async (ctx: Ctx, text: string) =>
  (await searchMemory(ctx, { text })).facts.map((fact) => fact.id);

describe("who sees a note", () => {
  it("only its teller: no colleague, admin, or org-credential view", async () => {
    const { orgA, byAcme, acme } = await setupTold();
    const [admin, member] = [orgA.admin.ctx, orgA.member.ctx];
    const system = systemCtx(orgA.id);
    const id = await tell(member, { about: { objectId: acme.id }, statement: PRIYA_NOTE });

    expect(await searched(member, "Priya renewals")).toContain(id);
    expect((await readObject(member, byAcme)).facts.map((f) => f.id)).toContain(id);
    for (const ctx of [admin, system]) {
      expect(await searched(ctx, "Priya renewals")).not.toContain(id);
      expect((await readObject(ctx, byAcme)).facts.map((f) => f.id)).not.toContain(id);
    }
    // The builder's company-wide view doesn't, even for the teller.
    const wide = await searchCompanyWideMemory(member, { text: "Priya renewals" });
    expect(wide.facts.map((fact) => fact.id)).not.toContain(id);

    expect(await citeFacts(member, [id])).toEqual([
      { id, sources: [], conflictsWith: null, outsideOnly: false, told: true },
    ]);
    expect(await citeFacts(admin, [id])).toEqual([]);
  });

  it("keeps a colleague's same words as their own note, and learning never joins one", async () => {
    const { orgA, acme, byAcme } = await setupTold();
    const [admin, member] = [orgA.admin.ctx, orgA.member.ctx];
    const june = "Acme renews every June.";
    const mine = await tell(member, { about: { objectId: acme.id }, statement: june });
    const theirs = await tell(admin, { about: { objectId: acme.id }, statement: june });
    // Then a source says the same words.
    await learnInInbox(
      orgA,
      `support@${orgA.workspaceDomain}`,
      "Acme renews every June, as always.",
      june,
      "Acme renews every June",
    );

    expect(theirs).not.toBe(mine);
    const forMember = (await readObject(member, byAcme)).facts.filter((f) => f.statement === june);
    const forAdmin = (await readObject(admin, byAcme)).facts.filter((f) => f.statement === june);
    expect(forMember.map((fact) => [fact.id === mine, fact.told])).toEqual(
      expect.arrayContaining([
        [true, true],
        [false, false],
      ]),
    );
    expect(forMember).toHaveLength(2);
    expect(forAdmin.map((fact) => fact.id)).not.toContain(mine);
    expect(forAdmin.find((fact) => fact.id === theirs)?.sources).toEqual([]);
    const learned = forAdmin.find((fact) => !fact.told);
    expect(learned?.sources).toHaveLength(1);
  });
});

describe("notes over time", () => {
  it("a newer note replaces the teller's older one, as history, touching nothing else", async () => {
    const { orgA, acme, byAcme } = await setupTold();
    const [admin, member] = [orgA.admin.ctx, orgA.member.ctx];
    const about = { objectId: acme.id };
    const priya = await tell(member, { about, statement: PRIYA_NOTE }, "renewal_contact");
    const lee = await tell(admin, { about, statement: "Acme renews via Lee." }, "renewal_contact");
    const tom = await tell(member, { about, statement: TOM_NOTE }, "renewal_contact");

    const forMember = await readObject(member, byAcme);
    expect(forMember.facts.map((fact) => fact.statement).toSorted()).toEqual(
      [SALES_FACT, TOM_NOTE].toSorted(),
    );
    expect(forMember.history).toEqual([
      expect.objectContaining({ id: priya, supersededBy: tom, told: true }),
    ]);
    const forAdmin = await readObject(admin, byAcme);
    expect(forAdmin.facts.map((fact) => fact.id)).toContain(lee);
    expect(forAdmin.facts.map((fact) => fact.statement)).toContain(SALES_FACT);
    expect(forAdmin.history).toEqual([]);

    // A newer source on the same point replaces no note (and, from outside, no company fact).
    const kim = "Acme's renewal contact is now Kim Park.";
    await learnInInbox(
      orgA,
      `support@${orgA.workspaceDomain}`,
      "Our renewal contact is now Kim Park.",
      kim,
      "Our renewal contact is now Kim Park",
      daysAgo(1),
    );
    const later = await readObject(member, byAcme);
    expect(later.facts.map((fact) => fact.statement).toSorted()).toEqual(
      [kim, SALES_FACT, TOM_NOTE].toSorted(),
    );
    expect(later.history.map((fact) => fact.statement)).toEqual([PRIYA_NOTE]);
    expect((await readObject(admin, byAcme)).facts.map((fact) => fact.id)).toContain(lee);
  });

  it("the same note twice is one note, with no second model call", async () => {
    const { orgA, acme, byAcme } = await setupTold();
    const member = orgA.member.ctx;
    const first = await tell(member, { about: { objectId: acme.id }, statement: PRIYA_NOTE });
    const calls = fakeAiGateway.requests().length;

    const again = await tellFact(member, { about: { objectId: acme.id }, statement: PRIYA_NOTE });

    expect(again).toMatchObject({ saved: true, fact: { id: first } });
    expect(fakeAiGateway.requests()).toHaveLength(calls);
    const notes = (await readObject(member, byAcme)).facts.filter(
      (f) => f.statement === PRIYA_NOTE,
    );
    expect(notes).toHaveLength(1);
  });
});

describe("deleting notes", () => {
  it("they go when their teller is removed, with any object only they named", async () => {
    const { orgA, acme } = await setupTold();
    const [admin, member] = [orgA.admin.ctx, orgA.member.ctx];
    await tell(member, { about: { objectId: acme.id }, statement: PRIYA_NOTE });
    await tell(member, { about: { email: PRIYA }, statement: "Priya Shah runs Globex." });
    const kept = await tell(admin, { about: { objectId: acme.id }, statement: TOM_NOTE });

    await removeUser(admin, orgA.member.id);

    for (const text of [PRIYA_NOTE, "Priya Shah runs Globex.", PRIYA]) {
      expect(await tablesHolding(text)).toEqual([]);
    }
    expect(await searched(admin, "renewals Tom")).toContain(kept);
    // Acme stays: the source and the admin's note are about it.
    expect((await readObject(admin, { id: acme.id })).id).toBe(acme.id);
  });

  it("they go when an admin forgets the person they're about", async () => {
    const { orgA } = await setupTold();
    const statement = "Priya Shah handles Globex's invoices.";
    await tell(orgA.member.ctx, { about: { email: PRIYA }, statement });

    expect(await forgetPerson(orgA.admin.ctx, { email: PRIYA })).toEqual({ facts: 1 });

    await expect(readObject(orgA.member.ctx, byEmail(PRIYA))).rejects.toThrow(NotFoundError);
    expect(await tablesHolding(statement)).toEqual([]);
  });
});

describe("reading notes' query budget", () => {
  it("makes the same queries for a few notes as for many", async () => {
    const { orgA, acme, byAcme } = await setupTold();
    const member = orgA.member.ctx;
    const note = (n: number) =>
      tell(member, { about: { objectId: acme.id }, statement: `Acme renewals note ${String(n)}.` });
    const reads = async (ids: string[]) => [
      (await countQueries(() => searchMemory(member, { text: "Acme renewals" }))).queries,
      (await countQueries(() => readObject(member, byAcme))).queries,
      (await countQueries(() => citeFacts(member, ids))).queries,
    ];
    // Two notes and the learned fact: as many as seed a search's meaning list (three).
    const ids = [await note(1), await note(2)];
    const few = await reads(ids);

    for (let n = 3; n <= 8; n += 1) ids.push(await note(n));

    expect(await reads(ids)).toEqual(few);
  });
});
