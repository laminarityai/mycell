import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { getConnection, listConnections } from "@/features/connections/server";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import * as server from "../server";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeGooglePush } from "@/testing/fake-google-push";
import { fakeInngest } from "@/testing/fake-inngest";

const CUSTOMER = "alice@customer.example";

const polled = () => fakeInngest.sent("discovery/connection.poll-due").map((event) => event.data);

// Org B's member and org B's shared inbox both hear from the same customer as org A, and are
// backfilled, then hear from them again, so every case can check org B is left as it was (a
// poll reaching org B would store the second message).
async function seedOrgB({ orgB }: TwoOrgs) {
  const inbox = `support@${orgB.workspaceDomain}`;
  const member = await connectMailbox(orgB.member.ctx, orgB.member.email, [
    { from: CUSTOMER, to: [orgB.member.email], text: "Hi", at: daysAgo(1) },
  ]);
  const org = await connectMailbox(
    orgB.admin.ctx,
    inbox,
    [{ from: CUSTOMER, to: [inbox], text: "Hi", at: daysAgo(1) }],
    "org",
  );
  await server.backfillConnection(orgB.member.ctx, member.id);
  await server.backfillConnection(orgB.admin.ctx, org.id);
  member.mailbox.add({ from: CUSTOMER, to: [orgB.member.email], text: "Again", at: new Date() });
  org.mailbox.add({ from: CUSTOMER, to: [inbox], text: "Again", at: new Date() });
  return { ids: [member.id, org.id], snapshot: () => orgBState(orgB) };
}

async function orgBState(orgB: TwoOrgs["orgB"]) {
  return {
    memberEvents: await server.findEventsByObject(orgB.member.ctx, "email", CUSTOMER),
    adminEvents: await server.findEventsByObject(orgB.admin.ctx, "email", CUSTOMER),
    listing: await listConnections(orgB.admin.ctx),
    memberListing: await listConnections(orgB.member.ctx),
  };
}

export const isolationCases = defineIsolationCases(server, {
  backfillConnection: async (orgs) => {
    const { ids, snapshot } = await seedOrgB(orgs);
    const before = await snapshot();

    for (const id of ids) {
      for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx]) {
        expect(await server.backfillConnection(ctx, id)).toEqual({ outcome: "gone" });
      }
    }

    expect(await snapshot()).toEqual(before);
  },

  markBackfillFailed: async (orgs) => {
    const { ids, snapshot } = await seedOrgB(orgs);
    const before = await snapshot();

    for (const id of ids) await server.markBackfillFailed(orgs.orgA.admin.ctx, id);

    expect(await snapshot()).toEqual(before);
  },

  pollConnection: async (orgs) => {
    const { ids, snapshot } = await seedOrgB(orgs);
    const before = await snapshot();
    const { orgA } = orgs;

    for (const id of ids) {
      for (const ctx of [orgA.admin.ctx, orgA.member.ctx, systemCtx(orgA.id)]) {
        expect(await server.pollConnection(ctx, id)).toEqual({ outcome: "gone" });
      }
    }

    expect(await snapshot()).toEqual(before);
  },

  // Cross-org by design: it lists every org's connections for the polling cron. What it must
  // keep straight is which org each poll acts in: always the connection's own.
  pollAllConnections: async (orgs) => {
    const { ids } = await seedOrgB(orgs);
    const { orgA, orgB } = orgs;
    const own = await connectMailbox(orgA.member.ctx, orgA.member.email);
    await server.backfillConnection(orgA.member.ctx, own.id);

    const due = await server.pollAllConnections();

    expect(due).toEqual(
      expect.arrayContaining([
        { orgId: orgA.id, connectionId: own.id },
        ...ids.map((connectionId) => ({ orgId: orgB.id, connectionId })),
      ]),
    );
    expect(due).toHaveLength(3);
    for (const { orgId, connectionId } of due) {
      const other = orgId === orgA.id ? orgB.id : orgA.id;
      expect(await getConnection(systemCtx(orgId), connectionId)).toMatchObject({
        id: connectionId,
      });
      await expect(getConnection(systemCtx(other), connectionId)).rejects.toThrow(NotFoundError);
    }
  },

  // Takes no ctx: a notification names only an address. Org A's notifications must start only
  // org A's polls, and an address in org B only org B's.
  handleGmailPush: async (orgs) => {
    const { ids } = await seedOrgB(orgs);
    const { orgA, orgB } = orgs;
    const own = await connectMailbox(orgA.member.ctx, orgA.member.email);
    await server.backfillConnection(orgA.member.ctx, own.id);

    for (const address of [orgA.member.email, `support@${orgA.workspaceDomain}`]) {
      expect((await fakeGooglePush.notify(address)).status).toBe(204);
    }
    expect(polled()).toEqual([{ orgId: orgA.id, connectionId: own.id }]);

    for (const address of [orgB.member.email, `support@${orgB.workspaceDomain}`]) {
      await fakeGooglePush.notify(address);
    }
    expect(polled().slice(1)).toEqual(
      ids.map((connectionId) => ({ orgId: orgB.id, connectionId })),
    );
  },

  findEventsByObject: async (orgs) => {
    const { snapshot } = await seedOrgB(orgs);
    const before = await snapshot();
    expect(before.adminEvents).toHaveLength(1);

    expect(await server.findEventsByObject(orgs.orgA.admin.ctx, "email", CUSTOMER)).toEqual([]);
    const { orgA } = orgs;
    const own = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      { from: CUSTOMER, to: [orgA.member.email], text: "Hi", at: daysAgo(1) },
    ]);
    await server.backfillConnection(orgA.member.ctx, own.id);

    const found = await server.findEventsByObject(orgA.member.ctx, "email", CUSTOMER);
    expect(found.map((event) => event.connectionId)).toEqual([own.id]);
    expect(await snapshot()).toEqual(before);
  },

  countStoredItems: async (orgs) => {
    await seedOrgB(orgs);

    expect(await server.countStoredItems(orgs.orgB.admin.ctx)).toBe(2);
    for (const ctx of [orgs.orgA.admin.ctx, systemCtx(orgs.orgA.id)]) {
      expect(await server.countStoredItems(ctx)).toBe(0);
    }
  },

  listStoredItems: async (orgs) => {
    await seedOrgB(orgs);

    expect((await server.listStoredItems(orgs.orgB.admin.ctx, { limit: 10 })).items).toHaveLength(
      2,
    );
    for (const ctx of [orgs.orgA.admin.ctx, systemCtx(orgs.orgA.id)]) {
      expect(await server.listStoredItems(ctx, { limit: 10 })).toEqual({ items: [], next: null });
    }
  },
});
