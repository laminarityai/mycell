// Isolation cases for memory's settings (the estimate, the budget and exclusions) and the jobs
// that act on them, spread into memory's isolationCases.
import { expect } from "vitest";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { pollConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { fakeInngest } from "@/testing/fake-inngest";
import * as server from "../server";
import { DANA, seedOrgB } from "./isolation-seed";
import { learnStoredItems } from "./memory-helpers";

// Org B has also excluded a domain: its settings, with Dana's object, are what org A mustn't
// see or change.
async function seedOrgBSettings(orgs: TwoOrgs) {
  const seeded = await seedOrgB(orgs);
  const { orgB } = orgs;
  const exclusion = await server.addExclusion(orgB.admin.ctx, {
    kind: "domain",
    value: "globex.example",
  });
  const settingsSnapshot = async () => ({
    settings: await server.getMemorySettings(orgB.admin.ctx),
    object: await seeded.snapshot(),
  });
  return { ...seeded, exclusion, settingsSnapshot, before: await settingsSnapshot() };
}

const runInline = <T>(_id: string, run: () => Promise<T>) => run();

export const settingsIsolationCases = {
  getMemorySettings: async (orgs: TwoOrgs) => {
    await seedOrgBSettings(orgs);

    const settings = await server.getMemorySettings(orgs.orgA.admin.ctx);
    expect(settings).toMatchObject({ started: null, spentThisMonth: 0, postponedItems: 0 });
    expect(settings.estimate.items).toBe(0);
    expect(settings.exclusions).toEqual([]);
  },

  startMemory: async (orgs: TwoOrgs) => {
    const { settingsSnapshot, before } = await seedOrgBSettings(orgs);

    await server.startMemory(orgs.orgA.admin.ctx, { monthlyBudget: 7 });

    expect((await server.getMemorySettings(orgs.orgA.admin.ctx)).started?.monthlyBudget).toBe(7);
    expect(await settingsSnapshot()).toEqual(before);
  },

  setMemoryBudget: async (orgs: TwoOrgs) => {
    const { settingsSnapshot, before } = await seedOrgBSettings(orgs);

    // Org B started memory; org A didn't.
    await expect(server.setMemoryBudget(orgs.orgA.admin.ctx, { monthlyBudget: 3 })).rejects.toThrow(
      ConflictError,
    );

    expect(await settingsSnapshot()).toEqual(before);
  },

  addExclusion: async (orgs: TwoOrgs) => {
    const { settingsSnapshot, before } = await seedOrgBSettings(orgs);
    const { orgA } = orgs;

    const exclusion = await server.addExclusion(orgA.admin.ctx, {
      kind: "domain",
      value: "acme.example",
    });
    await server.forgetExcluded(systemCtx(orgA.id), exclusion.id, runInline);

    expect(await settingsSnapshot()).toEqual(before);
  },

  removeExclusion: async (orgs: TwoOrgs) => {
    const { exclusion, settingsSnapshot, before } = await seedOrgBSettings(orgs);

    await expect(server.removeExclusion(orgs.orgA.admin.ctx, exclusion.id)).rejects.toThrow(
      NotFoundError,
    );

    expect(await settingsSnapshot()).toEqual(before);
  },

  forgetExcluded: async (orgs: TwoOrgs) => {
    const { orgB } = orgs;
    const { settingsSnapshot } = await seedOrgBSettings(orgs);
    // An exclusion of org B's that covers Dana, not yet applied: org A applying it must not.
    const exclusion = await server.addExclusion(orgB.admin.ctx, { kind: "address", value: DANA });
    const before = await settingsSnapshot();

    expect(await server.forgetExcluded(systemCtx(orgs.orgA.id), exclusion.id, runInline)).toEqual({
      sourceRecords: 0,
    });
    for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx]) {
      await expect(server.forgetExcluded(ctx, exclusion.id, runInline)).rejects.toThrow(
        ForbiddenError,
      );
    }

    expect(await settingsSnapshot()).toEqual(before);
  },

  hasMemoryStarted: async (orgs: TwoOrgs) => {
    const { settingsSnapshot, before } = await seedOrgBSettings(orgs);

    // Org B started memory; org A didn't.
    expect(await server.hasMemoryStarted(systemCtx(orgs.orgA.id))).toBe(false);
    expect(await server.hasMemoryStarted(systemCtx(orgs.orgB.id))).toBe(true);
    for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx]) {
      await expect(server.hasMemoryStarted(ctx)).rejects.toThrow(ForbiddenError);
    }

    expect(await settingsSnapshot()).toEqual(before);
  },

  queueStoredItems: async (orgs: TwoOrgs) => {
    await seedOrgBSettings(orgs);
    const sent = fakeInngest.sent("memory/item.queued").length;

    expect(await server.queueStoredItems(systemCtx(orgs.orgA.id), runInline)).toEqual({
      queued: 0,
    });

    expect(fakeInngest.sent("memory/item.queued")).toHaveLength(sent);
  },

  resumePostponed: async (orgs: TwoOrgs) => {
    const { orgB } = orgs;
    const { mailbox } = await seedOrgBSettings(orgs);
    // Org B's budget is spent (the injection screen cost a little), so its next email waits.
    await server.setMemoryBudget(orgB.admin.ctx, { monthlyBudget: 0.000001 });
    mailbox.mailbox.add({ from: DANA, to: [orgB.member.email], text: "Hi", at: new Date() });
    await pollConnection(systemCtx(orgB.id), mailbox.id);
    expect(await learnStoredItems(orgB.id)).toEqual([{ outcome: "skipped", reason: "postponed" }]);
    const sent = fakeInngest.sent("memory/item.queued").length;

    expect(await server.resumePostponed(systemCtx(orgs.orgA.id))).toEqual({ queued: 0 });

    expect(fakeInngest.sent("memory/item.queued")).toHaveLength(sent);
    expect((await server.getMemorySettings(orgB.admin.ctx)).postponedItems).toBe(1);
  },
};
