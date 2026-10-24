// "What I've told Mycel" (M9): a person lists their own told facts, newest first, with what each
// replaced, filters them by words, and deletes one. A deleted note leaves their memory view at
// once (the note it replaced is current again), can be brought back for a short undo window,
// and is then gone for good. Nobody else, admins included, lists, deletes or restores it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedUser } from "@/db/testing/two-org-fixture";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { fakeInngest } from "@/testing/fake-inngest";
import {
  citeFacts,
  deleteToldFact,
  listAccessLog,
  listToldFacts,
  purgeDeletedToldFacts,
  readObject,
  restoreToldFact,
  searchMemory,
  tellFact,
} from "../server";
import { TOLD_UNDO_MINUTES, type TellFactInput } from "../types";
import { scriptTelling } from "./memory-helpers";
import { PRIYA, PRIYA_NOTE, SALES_FACT, setupTold, TOM_NOTE } from "./told-setup";

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
});

const GLOBEX_NOTE = "Priya Shah runs Globex.";

async function tell(ctx: Ctx, input: TellFactInput, predicate?: string): Promise<string> {
  scriptTelling(predicate === undefined ? {} : { predicate, value: "someone" });
  const told = await tellFact(ctx, input);
  if (!told.saved) throw new Error(`Not saved: ${told.reason}`);
  return told.fact.id;
}

/** The member's notes: Priya then Tom on Acme's renewals (Tom replacing Priya), then Globex. */
async function memberNotes() {
  const setup = await setupTold();
  const member = setup.orgA.member.ctx;
  const about = { objectId: setup.acme.id };
  const priya = await tell(member, { about, statement: PRIYA_NOTE }, "renewal_contact");
  const tom = await tell(member, { about, statement: TOM_NOTE }, "renewal_contact");
  const globex = await tell(member, { about: { email: PRIYA }, statement: GLOBEX_NOTE });
  return { ...setup, member, priya, tom, globex };
}

const statements = async (ctx: Ctx, filter?: Parameters<typeof listToldFacts>[1]) =>
  (await listToldFacts(ctx, filter)).notes.map((note) => note.statement);

const searched = async (ctx: Ctx, text: string) =>
  (await searchMemory(ctx, { text })).facts.map((fact) => fact.id);

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe("listing what a person told Mycel", () => {
  it("lists only their own current notes, newest first, with what each replaced", async () => {
    const { orgA, acme, member, tom, globex } = await memberNotes();
    const admin = orgA.admin.ctx;
    const adminNote = await tell(admin, {
      about: { objectId: acme.id },
      statement: "Acme pays late.",
    });

    const listed = await listToldFacts(member);

    expect(listed.total).toBe(2);
    expect(listed.notes).toEqual([
      {
        id: globex,
        statement: GLOBEX_NOTE,
        toldAt: expect.any(Date) as Date,
        about: { id: expect.any(String) as string, kind: "person", name: PRIYA, key: PRIYA },
        replaced: null,
        replacedAt: null,
      },
      {
        id: tom,
        statement: TOM_NOTE,
        toldAt: expect.any(Date) as Date,
        about: { id: acme.id, kind: "company", name: "Acme", key: "acme.example" },
        replaced: { statement: PRIYA_NOTE, earlier: 0 },
        replacedAt: null,
      },
    ]);
    expect(listed.notes.map((note) => note.statement)).not.toContain(SALES_FACT);
    expect((await listToldFacts(admin)).notes.map((note) => note.id)).toEqual([adminNote]);
    await expect(listToldFacts(systemCtx(orgA.id))).rejects.toThrow(ForbiddenError);
  });

  it("adds replaced notes as rows of their own with Include older notes", async () => {
    const { member, priya } = await memberNotes();

    const listed = await listToldFacts(member, { includeOlder: true });

    expect(listed.notes.map((note) => note.statement)).toEqual([GLOBEX_NOTE, TOM_NOTE, PRIYA_NOTE]);
    expect(listed.notes.at(2)).toMatchObject({
      id: priya,
      replaced: null,
      replacedAt: expect.any(Date) as Date,
    });
    // The count is of current notes, whatever the rows.
    expect(listed.total).toBe(2);
  });

  it("filters by every word, in what was said, who it's about, or their address", async () => {
    const { member } = await memberNotes();

    expect(await statements(member, { words: "globex" })).toEqual([GLOBEX_NOTE]);
    expect(await statements(member, { words: "ACME" })).toEqual([TOM_NOTE]);
    expect(await statements(member, { words: "acme.example renewals" })).toEqual([TOM_NOTE]);
    expect(await statements(member, { words: "priya" })).toEqual([GLOBEX_NOTE]);
    expect(await statements(member, { words: "priya", includeOlder: true })).toEqual([
      GLOBEX_NOTE,
      PRIYA_NOTE,
    ]);
    expect(await statements(member, { words: "acme globex" })).toEqual([]);
    expect(await statements(member, { words: "  " })).toEqual([GLOBEX_NOTE, TOM_NOTE]);
  });

  it("is logged as the person's read", async () => {
    const { orgA, member } = await memberNotes();

    await listToldFacts(member);

    const [read] = await listAccessLog(orgA.admin.ctx);
    expect(read).toMatchObject({
      operation: "list_told",
      reader: { kind: "person", userId: orgA.member.id },
      factCount: 2,
    });
  });

  it("makes the same queries for a few notes as for many", async () => {
    const { acme, member } = await memberNotes();
    const list = () => listToldFacts(member, { includeOlder: true, words: "acme" });
    const few = await countQueries(list);
    expect((await list()).notes).toHaveLength(2);

    for (let n = 1; n <= 8; n += 1) {
      const about = n % 2 === 0 ? { objectId: acme.id } : { domain: `co${String(n)}.example` };
      await tell(member, { about, statement: `Acme note ${String(n)}.` }, `point_${String(n % 3)}`);
    }

    const many = await countQueries(list);
    expect(many.queries).toBe(few.queries);
    expect((await list()).notes).toHaveLength(10);
  });
});

describe("deleting a note", () => {
  it("takes it out of the teller's memory at once, and the note it replaced is current again", async () => {
    const { byAcme, member, priya, tom } = await memberNotes();

    const deleted = await deleteToldFact(member, tom);

    expect(deleted).toEqual({
      id: tom,
      statement: TOM_NOTE,
      undoUntil: expect.any(Date) as Date,
    });
    expect(await searched(member, "renewals Tom")).not.toContain(tom);
    const acme = await readObject(member, byAcme);
    expect(acme.facts.map((fact) => fact.id)).toContain(priya);
    expect(acme.facts.map((fact) => fact.id)).not.toContain(tom);
    expect(acme.history).toEqual([]);
    expect(await citeFacts(member, [tom])).toEqual([]);
    expect(await statements(member, { includeOlder: true })).toEqual([GLOBEX_NOTE, PRIYA_NOTE]);
    // Deleting it again finds nothing.
    await expect(deleteToldFact(member, tom)).rejects.toThrow(NotFoundError);
  });

  it("deletes an older note alone, leaving the newer one current", async () => {
    const { byAcme, member, priya, tom } = await memberNotes();

    await deleteToldFact(member, priya);

    const listed = await listToldFacts(member, { includeOlder: true });
    expect(listed.notes.map((note) => [note.id, note.replaced])).toEqual([
      [expect.any(String) as string, null],
      [tom, null],
    ]);
    const acme = await readObject(member, byAcme);
    expect(acme.facts.map((fact) => fact.id)).toContain(tom);
    expect(acme.history).toEqual([]);
  });

  it("can be undone within the window, as it was", async () => {
    const { byAcme, member, priya, tom } = await memberNotes();
    await deleteToldFact(member, tom);

    await restoreToldFact(member, tom);

    const acme = await readObject(member, byAcme);
    expect(acme.facts.map((fact) => fact.id)).toContain(tom);
    expect(acme.history.map((fact) => [fact.id, fact.supersededBy])).toEqual([[priya, tom]]);
    expect(await searched(member, "renewals Tom")).toContain(tom);
    expect((await listToldFacts(member)).notes.find((note) => note.id === tom)?.replaced).toEqual({
      statement: PRIYA_NOTE,
      earlier: 0,
    });
    // A note that isn't deleted has nothing to undo.
    await expect(restoreToldFact(member, tom)).rejects.toThrow(NotFoundError);
  });

  it("can't be undone once the window ends, and is then gone for good", async () => {
    const { orgA, member, tom, globex } = await memberNotes();
    const system = systemCtx(orgA.id);
    await deleteToldFact(member, tom);
    await deleteToldFact(member, globex);

    // Until the window ends, it's kept for undo, and nothing is purged.
    expect(fakeInngest.sent("memory/told-fact.deleted")).toEqual([
      expect.objectContaining({ data: { orgId: orgA.id, purgeAt: expect.any(String) as string } }),
      expect.objectContaining({ data: { orgId: orgA.id, purgeAt: expect.any(String) as string } }),
    ]);
    expect(await purgeDeletedToldFacts(system)).toEqual({ facts: 0 });
    expect(await tablesHolding(TOM_NOTE)).toEqual(["facts"]);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(minutesFromNow(TOLD_UNDO_MINUTES + 1));
    await expect(restoreToldFact(member, tom)).rejects.toThrow(ConflictError);
    expect(await purgeDeletedToldFacts(system)).toEqual({ facts: 2 });

    for (const text of [TOM_NOTE, GLOBEX_NOTE, PRIYA]) {
      expect(await tablesHolding(text)).toEqual([]);
    }
    await expect(restoreToldFact(member, tom)).rejects.toThrow(NotFoundError);
    // The note Tom replaced is current, and the learned fact untouched.
    expect(await statements(member)).toEqual([PRIYA_NOTE]);
    expect(await searched(member, "renewal contact Sam")).not.toEqual([]);
  });

  it("purges only for the org's system ctx", async () => {
    const { orgA, member } = await memberNotes();
    for (const ctx of [orgA.admin.ctx, member]) {
      await expect(purgeDeletedToldFacts(ctx)).rejects.toThrow(ForbiddenError);
    }
  });

  it("lets the same words be told again as a new note", async () => {
    const { acme, member, tom } = await memberNotes();
    await deleteToldFact(member, tom);

    const again = await tell(
      member,
      { about: { objectId: acme.id }, statement: TOM_NOTE },
      "renewal_contact",
    );

    expect(again).not.toBe(tom);
    expect(await searched(member, "renewals Tom")).toContain(again);
  });

  it("is the teller's alone: a colleague, an admin and the system ctx can't touch it", async () => {
    const { orgA, member, tom } = await memberNotes();
    const lee = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
    for (const ctx of [orgA.admin.ctx, lee.ctx]) {
      await expect(deleteToldFact(ctx, tom)).rejects.toThrow(NotFoundError);
      expect((await listToldFacts(ctx)).notes).toEqual([]);
    }
    await expect(deleteToldFact(systemCtx(orgA.id), tom)).rejects.toThrow(ForbiddenError);

    await deleteToldFact(member, tom);
    for (const ctx of [orgA.admin.ctx, lee.ctx]) {
      await expect(restoreToldFact(ctx, tom)).rejects.toThrow(NotFoundError);
    }
    await expect(restoreToldFact(systemCtx(orgA.id), tom)).rejects.toThrow(ForbiddenError);
    expect(await statements(member)).not.toContain(TOM_NOTE);
  });
});
