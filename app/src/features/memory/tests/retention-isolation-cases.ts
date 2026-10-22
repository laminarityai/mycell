// Isolation cases for retention and forgetting a person, spread into memory's isolationCases.
import { expect } from "vitest";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { pollConnection } from "@/features/discovery/server";
import { encryptForOrg } from "@/features/key-store/server";
import { systemCtx } from "@/lib/ctx";
import { ConflictError } from "@/lib/errors";
import { daysAgo } from "@/testing/connect-helpers";
import * as server from "../server";
import { DANA, seedOrgB } from "./isolation-seed";
import { learnStoredItems, scriptLearning, withCredits } from "./memory-helpers";

// Org B knows Dana, from last week and from two months ago: what org A must neither see nor
// change, with org B's settings.
async function seedOrgBMemory(orgs: TwoOrgs) {
  const seeded = await seedOrgB(orgs);
  const { orgB } = orgs;
  seeded.mailbox.mailbox.add({
    from: `Dana Ruiz <${DANA}>`,
    to: [orgB.member.email],
    text: "Acme renews in June.",
    at: daysAgo(60),
  });
  await pollConnection(systemCtx(orgB.id), seeded.mailbox.id);
  scriptLearning({
    objects: [{ ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA }],
    facts: [
      {
        about: "dana",
        statement: "Dana Ruiz's Acme renews in June.",
        evidence: "Acme renews in June",
      },
    ],
  });
  expect(await learnStoredItems(orgB.id)).toEqual([{ outcome: "learned", objects: 1, facts: 1 }]);
  const snapshot = async () => ({
    object: await seeded.snapshot(),
    settings: await server.getMemorySettings(orgs.orgB.admin.ctx),
  });
  return { snapshot, before: await snapshot() };
}

export const retentionIsolationCases = {
  forgetPerson: async (orgs: TwoOrgs) => {
    const { snapshot, before } = await seedOrgBMemory(orgs);

    expect(await server.forgetPerson(orgs.orgA.admin.ctx, { email: DANA })).toEqual({ facts: 0 });

    expect(await snapshot()).toEqual(before);
  },

  forgetPersonAgain: async (orgs: TwoOrgs) => {
    const { snapshot, before } = await seedOrgBMemory(orgs);
    const { orgA, orgB } = orgs;

    // Org B's encrypted address doesn't open for org A, and org A's own finds nothing of B's.
    const forB = await encryptForOrg(systemCtx(orgB.id), DANA);
    expect(await server.forgetPersonAgain(systemCtx(orgA.id), forB)).toEqual({ facts: 0 });
    const forA = await encryptForOrg(systemCtx(orgA.id), DANA);
    expect(await server.forgetPersonAgain(systemCtx(orgA.id), forA)).toEqual({ facts: 0 });

    expect(await snapshot()).toEqual(before);
  },

  setRetentionWindow: async (orgs: TwoOrgs) => {
    const { snapshot, before } = await seedOrgBMemory(orgs);
    const { orgA } = orgs;

    // Org B started memory; org A didn't, until now.
    await expect(server.setRetentionWindow(orgA.admin.ctx, { months: 1 })).rejects.toThrow(
      ConflictError,
    );
    await withCredits(orgA.id);
    await server.setRetentionWindow(orgA.admin.ctx, { months: 1 });

    expect(await snapshot()).toEqual(before);
  },

  applyRetention: async (orgs: TwoOrgs) => {
    const { snapshot, before } = await seedOrgBMemory(orgs);
    const { orgA } = orgs;
    await withCredits(orgA.id);
    await server.setRetentionWindow(orgA.admin.ctx, { months: 1 });

    expect(await server.applyRetention(systemCtx(orgA.id))).toEqual({
      sourceRecords: 0,
      facts: 0,
      objects: 0,
    });

    expect(await snapshot()).toEqual(before);
  },
};
