// Isolation cases for told facts ("remember this"), spread into memory's isolationCases.
import { expect } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { resetNow, setNow } from "@/lib/time";
import * as server from "../server";
import { TOLD_UNDO_MINUTES } from "../types";
import { DANA, seedOrgB } from "./isolation-seed";
import { grantOnly, scriptTelling } from "./memory-helpers";

const ORG_B_NOTE = "Dana prefers calls on Fridays.";

/** Org B's member tells Mycel a note about Dana, and org A's member one of their own. */
async function toldInBoth(orgs: TwoOrgs) {
  const { object } = await seedOrgB(orgs);
  const { orgA, orgB } = orgs;
  await grantOnly(orgA.id);
  scriptTelling();
  const told = await server.tellFact(orgB.member.ctx, {
    about: { objectId: object.id },
    statement: ORG_B_NOTE,
  });
  if (!told.saved) throw new Error("Org B's note wasn't saved");
  scriptTelling();
  await server.tellFact(orgA.member.ctx, { about: { email: DANA }, statement: "Dana likes tea." });
  const snapshot = () => server.listToldFacts(orgB.member.ctx, { includeOlder: true });
  return { noteId: told.fact.id, snapshot };
}

export const toldIsolationCases = {
  tellFact: async (orgs: TwoOrgs) => {
    const { object, snapshot } = await seedOrgB(orgs);
    const before = await snapshot();
    const { orgA, orgB } = orgs;
    await grantOnly(orgA.id);
    await server.forgetPerson(orgB.admin.ctx, { email: "priya@globex.example" });
    const member = orgA.member.ctx;

    // Org B's object isn't one org A can name.
    await expect(
      server.tellFact(member, { about: { objectId: object.id }, statement: "Dana likes calls." }),
    ).rejects.toThrow(NotFoundError);
    // Dana's address makes org A its own object, never joining org B's.
    scriptTelling();
    const told = await server.tellFact(member, {
      about: { email: DANA },
      statement: "Dana likes calls.",
    });
    expect(told).toMatchObject({ saved: true });
    expect(told.saved && told.fact.about.id).not.toBe(object.id);
    // Org B's do-not-learn list isn't org A's.
    scriptTelling();
    const priya = await server.tellFact(member, {
      about: { email: "priya@globex.example" },
      statement: "Priya runs Globex.",
    });
    expect(priya).toMatchObject({ saved: true });

    expect(await snapshot()).toEqual(before);
  },

  listToldFacts: async (orgs: TwoOrgs) => {
    const { snapshot } = await toldInBoth(orgs);
    const before = await snapshot();
    const { orgA } = orgs;

    // Org A's member sees only their own note; no one in org A sees org B's.
    const listed = await server.listToldFacts(orgA.member.ctx, { words: "Dana" });
    expect(listed.notes.map((note) => note.statement)).toEqual(["Dana likes tea."]);
    expect((await server.listToldFacts(orgA.admin.ctx)).notes).toEqual([]);

    expect(await snapshot()).toEqual(before);
  },

  deleteToldFact: async (orgs: TwoOrgs) => {
    const { noteId, snapshot } = await toldInBoth(orgs);
    const before = await snapshot();
    const { orgA } = orgs;

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      await expect(server.deleteToldFact(ctx, noteId)).rejects.toThrow(NotFoundError);
    }

    expect(await snapshot()).toEqual(before);
  },

  restoreToldFact: async (orgs: TwoOrgs) => {
    const { noteId, snapshot } = await toldInBoth(orgs);
    await server.deleteToldFact(orgs.orgB.member.ctx, noteId);
    const before = await snapshot();
    const { orgA } = orgs;

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      await expect(server.restoreToldFact(ctx, noteId)).rejects.toThrow(NotFoundError);
    }

    expect(await snapshot()).toEqual(before);
    // Still deleted, and still org B's own to bring back.
    await server.restoreToldFact(orgs.orgB.member.ctx, noteId);
  },

  purgeDeletedToldFacts: async (orgs: TwoOrgs) => {
    const { noteId } = await toldInBoth(orgs);
    await server.deleteToldFact(orgs.orgB.member.ctx, noteId);
    try {
      setNow(new Date(Date.now() + (TOLD_UNDO_MINUTES + 1) * 60_000));

      expect(await server.purgeDeletedToldFacts(systemCtx(orgs.orgA.id))).toEqual({ facts: 0 });

      expect(await tablesHolding(ORG_B_NOTE)).toEqual(["facts"]);
    } finally {
      resetNow();
    }
  },
};
