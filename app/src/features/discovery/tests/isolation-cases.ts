import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { listConnections } from "@/features/connections/server";
import * as server from "../server";
import { connectMailbox, daysAgo } from "./ingest-helpers";

const CUSTOMER = "alice@customer.example";

// Org B's member and org B's shared inbox both hear from the same customer as org A, and are
// backfilled, so every case can check org B is left as it was.
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
});
