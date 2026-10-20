import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import * as server from "../server";
import { connectGmail } from "./connect-helpers";

// Org B's member connects their Gmail, so every case can check org B is left as it was.
async function seedOrgBConnection({ orgB }: TwoOrgs) {
  await connectGmail(orgB.member.ctx, orgB.member.email);
  return { before: await server.listConnections(orgB.member.ctx) };
}

export const isolationCases = defineIsolationCases(server, {
  startConnect: async (orgs) => {
    const { before } = await seedOrgBConnection(orgs);

    await server.startConnect(orgs.orgA.member.ctx, "gmail");

    expect(await server.listConnections(orgs.orgB.member.ctx)).toEqual(before);
  },

  listConnections: async (orgs) => {
    await seedOrgBConnection(orgs);
    await connectGmail(orgs.orgA.member.ctx, orgs.orgA.member.email);

    const { connections } = await server.listConnections(orgs.orgA.member.ctx);

    expect(connections.map((c) => c.accountEmail)).toEqual([orgs.orgA.member.email]);
  },

  // The webhook carries no ctx: it acts as the user its tags name, inside that user's own org.
  handleNangoWebhook: async (orgs) => {
    const { before } = await seedOrgBConnection(orgs);

    // An org A attempt finished with an org B address is refused, and org B is untouched.
    await connectGmail(orgs.orgA.member.ctx, orgs.orgB.member.email);

    expect((await server.listConnections(orgs.orgA.member.ctx)).connections).toEqual([]);
    expect(await server.listConnections(orgs.orgB.member.ctx)).toEqual(before);
  },
});
