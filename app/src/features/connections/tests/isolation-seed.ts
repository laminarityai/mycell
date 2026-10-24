// The seed every connections isolation case starts from, shared by isolation-cases.ts and
// access-isolation-cases.ts.
import { expect } from "vitest";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { connectGmail, connectOrgInbox } from "@/testing/connect-helpers";
import * as server from "../server";
import type { ConnectionsListing } from "../types";

// Org B's member connects their Gmail and org B's admin a shared inbox, so every case can
// check org B is left as it was. Org B's admin sees all of it.
export async function seedOrgBConnection({ orgB }: TwoOrgs) {
  const { connectionId } = await connectGmail(orgB.member.ctx, orgB.member.email);
  await connectOrgInbox(orgB.admin.ctx, `support@${orgB.workspaceDomain}`);
  return {
    before: await server.listConnections(orgB.admin.ctx),
    memberBefore: await server.listConnections(orgB.member.ctx),
    nangoConnectionId: connectionId,
  };
}

// The IDs of org B's member connection and org connection.
export function orgBIds(admins: ConnectionsListing, members: ConnectionsListing): string[] {
  const ids = [...members.connections, ...admins.orgConnections].map((c) => c.id);
  expect(ids).toHaveLength(2);
  return ids;
}
