import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { NotFoundError } from "@/lib/errors";
import { fakeNango } from "@/testing/fake-nango";
import * as server from "../server";
import { connectGmail } from "./connect-helpers";

// Org B's member connects their Gmail, so every case can check org B is left as it was.
async function seedOrgBConnection({ orgB }: TwoOrgs) {
  const { connectionId } = await connectGmail(orgB.member.ctx, orgB.member.email);
  return {
    before: await server.listConnections(orgB.member.ctx),
    nangoConnectionId: connectionId,
  };
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

  disconnect: async (orgs) => {
    const { before } = await seedOrgBConnection(orgs);
    const orgBConnection = before.connections.at(0);
    if (orgBConnection === undefined) throw new Error("Org B's connection wasn't recorded");

    await expect(server.disconnect(orgs.orgA.admin.ctx, orgBConnection.id)).rejects.toThrow(
      NotFoundError,
    );

    expect(await server.listConnections(orgs.orgB.member.ctx)).toEqual(before);
  },

  deleteMemberConnectionsOf: async (orgs) => {
    const { before } = await seedOrgBConnection(orgs);

    // Org B's member isn't a member of org A, and their connections are out of org A's reach.
    await server.deleteMemberConnectionsOf(orgs.orgA.admin.ctx, orgs.orgB.member.id);

    expect(await server.listConnections(orgs.orgB.member.ctx)).toEqual(before);
  },

  // The webhook carries no ctx: it acts as the user its tags name, inside that user's own org.
  handleNangoWebhook: async (orgs) => {
    const { before, nangoConnectionId } = await seedOrgBConnection(orgs);

    // An org A attempt finished with an org B address is refused, and org B is untouched.
    await connectGmail(orgs.orgA.member.ctx, orgs.orgB.member.email);
    // A deletion naming org B's Nango connection, but tagged with org A, finds nothing.
    const deletion = fakeNango.signed({
      type: "auth",
      operation: "deletion",
      success: true,
      connectionId: nangoConnectionId,
      providerConfigKey: "google-mail",
      tags: {
        mycel_attempt_id: "x",
        end_user_id: orgs.orgA.member.id,
        organization_id: orgs.orgA.id,
      },
    });
    await server.handleNangoWebhook(deletion.rawBody, deletion.headers);

    expect((await server.listConnections(orgs.orgA.member.ctx)).connections).toEqual([]);
    expect(await server.listConnections(orgs.orgB.member.ctx)).toEqual(before);
  },
});
