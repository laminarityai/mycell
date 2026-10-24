// Isolation cases for told facts ("remember this"), spread into memory's isolationCases.
import { expect } from "vitest";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { NotFoundError } from "@/lib/errors";
import * as server from "../server";
import { DANA, seedOrgB } from "./isolation-seed";
import { grantOnly, scriptTelling } from "./memory-helpers";

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
};
