import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import * as server from "../server";
import { learnStoredItems, scriptLearning, withCredits } from "./memory-helpers";

const DANA = "dana@acme.example";
const byEmail = { key: { kind: "email" as const, value: DANA } };
const STAFF = "sam@mycel.example";
const CONSENT = { staffEmail: STAFF, reason: "Ticket 4411", days: 7 };

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

  summarizeObject: async (orgs) => {
    const { object, snapshot } = await seedOrgB(orgs);
    const { orgA } = orgs;
    const calls = fakeAiGateway.requests("language").length;

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx, systemCtx(orgA.id)]) {
      await expect(server.summarizeObject(ctx, { id: object.id })).rejects.toThrow(NotFoundError);
      await expect(server.summarizeObject(ctx, byEmail)).rejects.toThrow(NotFoundError);
    }

    expect(fakeAiGateway.requests("language")).toHaveLength(calls);
    expect(await snapshot()).toEqual(object);
  },

  listAccessLog: async (orgs) => {
    const { orgA, orgB } = orgs;
    await seedOrgB(orgs);
    const before = await server.listAccessLog(orgB.admin.ctx);
    expect(before).toHaveLength(1);

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      expect(await server.listAccessLog(ctx)).toEqual([]);
    }

    expect(await server.listAccessLog(orgB.admin.ctx)).toEqual(before);
  },

  pruneAccessLog: async (orgs) => {
    const { orgA, orgB } = orgs;
    await seedOrgB(orgs);
    const before = await server.listAccessLog(orgB.admin.ctx);

    const farFuture = new Date(Date.now() + 1000 * 24 * 60 * 60 * 1000);
    expect(await server.pruneAccessLog(systemCtx(orgA.id), farFuture)).toEqual({
      entries: 0,
      consents: 0,
    });

    expect(await server.listAccessLog(orgB.admin.ctx)).toEqual(before);
  },

  grantStaffConsent: async (orgs) => {
    const { orgA, orgB } = orgs;
    const consent = await server.grantStaffConsent(orgA.admin.ctx, CONSENT);

    expect(await server.listStaffConsents(orgB.admin.ctx)).toEqual([]);
    const access = { consentId: consent.id, staffEmail: STAFF };
    await seedOrgB(orgs);
    await expect(server.staffReadObject(systemCtx(orgB.id), access, byEmail)).rejects.toThrow(
      ForbiddenError,
    );
  },

  listStaffConsents: async ({ orgA, orgB }) => {
    await server.grantStaffConsent(orgB.admin.ctx, CONSENT);

    expect(await server.listStaffConsents(orgA.admin.ctx)).toEqual([]);
  },

  revokeStaffConsent: async ({ orgA, orgB }) => {
    const consent = await server.grantStaffConsent(orgB.admin.ctx, CONSENT);

    await expect(server.revokeStaffConsent(orgA.admin.ctx, consent.id)).rejects.toThrow(
      NotFoundError,
    );

    expect(await server.listStaffConsents(orgB.admin.ctx)).toEqual([consent]);
  },

  staffReadObject: async (orgs) => {
    const { orgA, orgB } = orgs;
    const { object } = await seedOrgB(orgs);
    const orgBConsent = await server.grantStaffConsent(orgB.admin.ctx, CONSENT);
    const orgAConsent = await server.grantStaffConsent(orgA.admin.ctx, CONSENT);
    const before = await server.listAccessLog(orgB.admin.ctx);

    // Org B's consent opens nothing in org A, and org A's opens nothing of org B's.
    await expect(
      server.staffReadObject(
        systemCtx(orgA.id),
        { consentId: orgBConsent.id, staffEmail: STAFF },
        byEmail,
      ),
    ).rejects.toThrow(ForbiddenError);
    const orgAAccess = { consentId: orgAConsent.id, staffEmail: STAFF };
    for (const lookup of [byEmail, { id: object.id }]) {
      await expect(server.staffReadObject(systemCtx(orgA.id), orgAAccess, lookup)).rejects.toThrow(
        NotFoundError,
      );
    }

    expect(await server.listAccessLog(orgB.admin.ctx)).toEqual(before);
  },

  staffSearchMemory: async (orgs) => {
    const { orgA, orgB } = orgs;
    await seedOrgB(orgs);
    const orgBConsent = await server.grantStaffConsent(orgB.admin.ctx, CONSENT);
    const orgAConsent = await server.grantStaffConsent(orgA.admin.ctx, CONSENT);
    const before = await server.listAccessLog(orgB.admin.ctx);

    await expect(
      server.staffSearchMemory(
        systemCtx(orgA.id),
        { consentId: orgBConsent.id, staffEmail: STAFF },
        { text: "procurement" },
      ),
    ).rejects.toThrow(ForbiddenError);
    const orgAAccess = { consentId: orgAConsent.id, staffEmail: STAFF };
    for (const search of [{ text: "procurement" }, byEmail]) {
      expect(await server.staffSearchMemory(systemCtx(orgA.id), orgAAccess, search)).toEqual({
        objects: [],
        facts: [],
      });
    }

    expect(await server.listAccessLog(orgB.admin.ctx)).toEqual(before);
  },

  // Org B's all-staff list: org A neither sees it nor unmarks it, and its own mark on the same
  // address is its own.
  listCompanyWideLists: async ({ orgA, orgB }) => {
    const allB = `all@${orgB.workspaceDomain}`;
    await server.markCompanyWideList(orgB.admin.ctx, allB);

    expect(await server.listCompanyWideLists(orgA.admin.ctx)).toEqual([]);
    expect((await server.listCompanyWideLists(orgB.admin.ctx)).map((l) => l.address)).toEqual([
      allB,
    ]);
  },

  markCompanyWideList: async ({ orgA, orgB }) => {
    const allA = `all@${orgA.workspaceDomain}`;
    const allB = `all@${orgB.workspaceDomain}`;
    await server.markCompanyWideList(orgB.admin.ctx, allB);

    // Another company's domain isn't org A's to mark.
    await expect(server.markCompanyWideList(orgA.admin.ctx, allB)).rejects.toThrow(ValidationError);
    await server.markCompanyWideList(orgA.admin.ctx, allA);

    expect((await server.listCompanyWideLists(orgB.admin.ctx)).map((l) => l.address)).toEqual([
      allB,
    ]);
  },

  unmarkCompanyWideList: async ({ orgA, orgB }) => {
    const allB = `all@${orgB.workspaceDomain}`;
    await server.markCompanyWideList(orgB.admin.ctx, allB);

    await server.unmarkCompanyWideList(orgA.admin.ctx, allB);

    expect((await server.listCompanyWideLists(orgB.admin.ctx)).map((l) => l.address)).toEqual([
      allB,
    ]);
  },
});
