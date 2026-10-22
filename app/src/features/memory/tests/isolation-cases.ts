import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { backfillConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
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

export const isolationCases = defineIsolationCases(server, {
  learnFromItem: async (orgs) => {
    const { mailbox, sourceRef, snapshot } = await seedOrgB(orgs);
    const before = await snapshot();
    const { orgA } = orgs;
    const item = { connectionId: mailbox.id, app: "gmail" as const, sourceRef };

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
