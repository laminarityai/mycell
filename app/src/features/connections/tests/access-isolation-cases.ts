// Isolation cases for who may read which connection (readable connections, owners, source
// clients, Gmail push lookups, shared inboxes), spread into connections' isolationCases.
import { expect } from "vitest";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { connectGmail, connectOrgInbox } from "@/testing/connect-helpers";
import * as server from "../server";
import { orgBIds, seedOrgBConnection } from "./isolation-seed";

export const accessIsolationCases = {
  readableConnectionIds: async (orgs: TwoOrgs) => {
    await seedOrgBConnection(orgs);
    const { orgA } = orgs;

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx, systemCtx(orgA.id)]) {
      expect(await server.readableConnectionIds(ctx)).toEqual([]);
    }
  },

  connectionOwners: async (orgs: TwoOrgs) => {
    const { before } = await seedOrgBConnection(orgs);
    const { orgA } = orgs;

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx, systemCtx(orgA.id)]) {
      expect(await server.connectionOwners(ctx)).toEqual([]);
    }
    expect(await server.listConnections(orgs.orgB.admin.ctx)).toEqual(before);
  },

  sourceClients: async (orgs: TwoOrgs) => {
    const { before, memberBefore } = await seedOrgBConnection(orgs);
    const ids = orgBIds(before, memberBefore);

    for (const ctx of [orgs.orgA.admin.ctx, systemCtx(orgs.orgA.id)]) {
      expect(await server.sourceClients(ctx, ids)).toEqual(new Map());
    }
    expect(await server.listConnections(orgs.orgB.admin.ctx)).toEqual(before);
  },

  gmailPushConnectionIds: async (orgs: TwoOrgs) => {
    await seedOrgBConnection(orgs);
    const { orgA, orgB } = orgs;
    const inbox = `support@${orgB.workspaceDomain}`;
    const orgBIds = (await server.listConnectionsForJobs(systemCtx(orgB.id))).map((c) => c.id);
    for (const id of orgBIds) {
      await server.recordIngestState(systemCtx(orgB.id), id, "gmail", { status: "active" });
    }

    for (const address of [orgB.member.email, inbox]) {
      const own = await server.gmailPushConnectionIds(systemCtx(orgB.id), address);
      expect(own).toHaveLength(1);
      expect(orgBIds).toContain(own[0]);
      expect(await server.gmailPushConnectionIds(systemCtx(orgA.id), address)).toEqual([]);
      for (const ctx of [orgB.admin.ctx, orgB.member.ctx]) {
        await expect(server.gmailPushConnectionIds(ctx, address)).rejects.toThrow(ForbiddenError);
      }
    }
  },

  sharedInboxes: async (orgs: TwoOrgs) => {
    const { before, memberBefore } = await seedOrgBConnection(orgs);
    const ids = orgBIds(before, memberBefore);
    await connectOrgInbox(orgs.orgA.admin.ctx, "support@org-a.test");
    await connectGmail(orgs.orgA.member.ctx, orgs.orgA.member.email);
    const orgAIds = [
      ...(await server.listConnections(orgs.orgA.admin.ctx)).orgConnections,
      ...(await server.listConnections(orgs.orgA.member.ctx)).connections,
    ].map((c) => c.id);
    expect(orgAIds).toHaveLength(2);

    // Org B's connections, and org A's member connection, aren't shared inboxes of org A.
    for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx]) {
      const inboxes = await server.sharedInboxes(ctx, [...ids, ...orgAIds]);
      expect([...inboxes.values()]).toEqual(["support@org-a.test"]);
    }
  },
};
