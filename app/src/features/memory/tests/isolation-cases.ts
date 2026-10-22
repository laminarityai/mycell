import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import * as server from "../server";
import { learnStoredItems, scriptLearning, withCredits } from "./memory-helpers";

const DANA = "dana@acme.example";
const byEmail = { key: { kind: "email" as const, value: DANA } };

// Org B's member hears from Dana at Acme, and memory learns about her: org A must neither see
// it nor change it.
async function seedOrgB({ orgB }: TwoOrgs) {
  await withCredits(orgB.id);
  const mailbox = await connectMailbox(orgB.member.ctx, orgB.member.email, [
    {
      from: `Dana Ruiz <${DANA}>`,
      to: [orgB.member.email],
      text: "I lead procurement at Acme.",
      at: daysAgo(1),
    },
  ]);
  await backfillConnection(orgB.member.ctx, mailbox.id);
  scriptLearning({
    objects: [{ ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA }],
    facts: [
      {
        about: "dana",
        statement: "Dana Ruiz leads procurement at Acme.",
        evidence: "I lead procurement at Acme",
      },
    ],
  });
  await learnStoredItems(orgB.id);
  const message = (mailbox.mailbox.list(new URLSearchParams()).messages ?? []).at(0);
  const snapshot = () => server.readObject(orgB.member.ctx, byEmail);
  return { mailbox, sourceRef: message?.id ?? "", object: await snapshot(), snapshot };
}

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

export const isolationCases = defineIsolationCases(server, {
  learnFromItem: async (orgs) => {
    const { mailbox, sourceRef, snapshot } = await seedOrgB(orgs);
    const before = await snapshot();
    const { orgA } = orgs;
    const item = { connectionId: mailbox.id, app: "gmail" as const, sourceRef };
    // Org A has started memory too, so learning goes as far as looking for the connection.
    await withCredits(orgA.id);

    expect(await server.learnFromItem(systemCtx(orgA.id), item)).toEqual({ outcome: "gone" });
    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      await expect(server.learnFromItem(ctx, item)).rejects.toThrow(ForbiddenError);
    }

    expect(await snapshot()).toEqual(before);
  },

  readObject: async (orgs) => {
    const { object, snapshot } = await seedOrgB(orgs);
    const { orgA } = orgs;

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx, systemCtx(orgA.id)]) {
      await expect(server.readObject(ctx, { id: object.id })).rejects.toThrow(NotFoundError);
      await expect(server.readObject(ctx, byEmail)).rejects.toThrow(NotFoundError);
    }

    expect(await snapshot()).toEqual(object);
  },

  searchMemory: async (orgs) => {
    const { object, snapshot } = await seedOrgB(orgs);
    const { orgA, orgB } = orgs;
    // Org B's member finds it, so a search that would find it is the one org A runs.
    const searches = [{ text: "procurement" }, { text: DANA }, byEmail];
    for (const search of searches) {
      expect((await server.searchMemory(orgB.member.ctx, search)).facts).toHaveLength(1);
    }

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx, systemCtx(orgA.id)]) {
      for (const search of searches) {
        expect(await server.searchMemory(ctx, search)).toEqual({ objects: [], facts: [] });
      }
    }

    expect(await snapshot()).toEqual(object);
  },

  getMemorySettings: async (orgs) => {
    await seedOrgBSettings(orgs);

    const settings = await server.getMemorySettings(orgs.orgA.admin.ctx);
    expect(settings).toMatchObject({ started: null, spentThisMonth: 0, postponedItems: 0 });
    expect(settings.estimate.items).toBe(0);
    expect(settings.exclusions).toEqual([]);
  },

  startMemory: async (orgs) => {
    const { settingsSnapshot, before } = await seedOrgBSettings(orgs);

    await server.startMemory(orgs.orgA.admin.ctx, { monthlyBudget: 7 });

    expect((await server.getMemorySettings(orgs.orgA.admin.ctx)).started?.monthlyBudget).toBe(7);
    expect(await settingsSnapshot()).toEqual(before);
  },

  setMemoryBudget: async (orgs) => {
    const { settingsSnapshot, before } = await seedOrgBSettings(orgs);

    // Org B started memory; org A didn't.
    await expect(server.setMemoryBudget(orgs.orgA.admin.ctx, { monthlyBudget: 3 })).rejects.toThrow(
      ConflictError,
    );

    expect(await settingsSnapshot()).toEqual(before);
  },

  addExclusion: async (orgs) => {
    const { settingsSnapshot, before } = await seedOrgBSettings(orgs);
    const { orgA } = orgs;

    const exclusion = await server.addExclusion(orgA.admin.ctx, {
      kind: "domain",
      value: "acme.example",
    });
    await server.forgetExcluded(systemCtx(orgA.id), exclusion.id, runInline);

    expect(await settingsSnapshot()).toEqual(before);
  },

  removeExclusion: async (orgs) => {
    const { exclusion, settingsSnapshot, before } = await seedOrgBSettings(orgs);

    await expect(server.removeExclusion(orgs.orgA.admin.ctx, exclusion.id)).rejects.toThrow(
      NotFoundError,
    );

    expect(await settingsSnapshot()).toEqual(before);
  },

  forgetExcluded: async (orgs) => {
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

  queueStoredItems: async (orgs) => {
    await seedOrgBSettings(orgs);
    const sent = fakeInngest.sent("memory/item.queued").length;

    expect(await server.queueStoredItems(systemCtx(orgs.orgA.id), runInline)).toEqual({
      queued: 0,
    });

    expect(fakeInngest.sent("memory/item.queued")).toHaveLength(sent);
  },

  resumePostponed: async (orgs) => {
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
});
