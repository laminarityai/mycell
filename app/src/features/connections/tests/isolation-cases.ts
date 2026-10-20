import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { NotFoundError } from "@/lib/errors";
import { fakeNango } from "@/testing/fake-nango";
import * as server from "../server";
import { connectGmail, connectOrgInbox } from "./connect-helpers";

// Org B's member connects their Gmail and org B's admin a shared inbox, so every case can
// check org B is left as it was. Org B's admin sees all of it.
async function seedOrgBConnection({ orgB }: TwoOrgs) {
  const { connectionId } = await connectGmail(orgB.member.ctx, orgB.member.email);
  await connectOrgInbox(orgB.admin.ctx, `support@${orgB.workspaceDomain}`);
  return {
    before: await server.listConnections(orgB.admin.ctx),
    memberBefore: await server.listConnections(orgB.member.ctx),
    nangoConnectionId: connectionId,
  };
}

export const isolationCases = defineIsolationCases(server, {
  startConnect: async (orgs) => {
    const { before } = await seedOrgBConnection(orgs);

    await server.startConnect(orgs.orgA.member.ctx, "gmail");
    await server.startConnect(orgs.orgA.admin.ctx, "gmail", "org");

    expect(await server.listConnections(orgs.orgB.admin.ctx)).toEqual(before);
  },

  listConnections: async (orgs) => {
    await seedOrgBConnection(orgs);
    await connectGmail(orgs.orgA.member.ctx, orgs.orgA.member.email);

    const mine = await server.listConnections(orgs.orgA.member.ctx);
    const admins = await server.listConnections(orgs.orgA.admin.ctx);

    expect(mine.connections.map((c) => c.accountEmail)).toEqual([orgs.orgA.member.email]);
    expect(admins.connections).toEqual([]);
    expect(admins.orgConnections).toEqual([]);
    expect(admins.memberConnections.map((c) => c.owner.userId)).toEqual([orgs.orgA.member.id]);
  },

  disconnect: async (orgs) => {
    const { before, memberBefore } = await seedOrgBConnection(orgs);
    const orgBIds = [
      ...memberBefore.connections.map((c) => c.id),
      ...before.orgConnections.map((c) => c.id),
    ];
    expect(orgBIds).toHaveLength(2);

    for (const id of orgBIds) {
      await expect(server.disconnect(orgs.orgA.admin.ctx, id)).rejects.toThrow(NotFoundError);
    }

    expect(await server.listConnections(orgs.orgB.admin.ctx)).toEqual(before);
    expect(await server.listConnections(orgs.orgB.member.ctx)).toEqual(memberBefore);
  },

  deleteMemberConnectionsOf: async (orgs) => {
    const { before, memberBefore } = await seedOrgBConnection(orgs);

    // Org B's member isn't a member of org A, and their connections are out of org A's reach.
    await server.deleteMemberConnectionsOf(orgs.orgA.admin.ctx, orgs.orgB.member.id);

    expect(await server.listConnections(orgs.orgB.admin.ctx)).toEqual(before);
    expect(await server.listConnections(orgs.orgB.member.ctx)).toEqual(memberBefore);
  },

  // The webhook carries no ctx: it acts as the user its tags name, inside that user's own org.
  handleNangoWebhook: async (orgs) => {
    const { before, nangoConnectionId } = await seedOrgBConnection(orgs);

    // Org A attempts finished with org B addresses are refused, and org B is untouched.
    await connectGmail(orgs.orgA.member.ctx, orgs.orgB.member.email);
    await connectOrgInbox(orgs.orgA.admin.ctx, `sales@${orgs.orgB.workspaceDomain}`);
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

    const orgAListing = await server.listConnections(orgs.orgA.admin.ctx);
    expect(orgAListing.orgConnections).toEqual([]);
    expect(orgAListing.memberConnections).toEqual([]);
    expect(await server.listConnections(orgs.orgB.admin.ctx)).toEqual(before);
  },
});
