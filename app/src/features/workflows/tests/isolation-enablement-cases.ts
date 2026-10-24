// The isolation cases (isolation-cases.ts) for reading enablements: org B's member has one, and
// org A's people, admin included, see none of it.
import { expect } from "vitest";
import { notTenantScoped } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { NotFoundError } from "@/lib/errors";
import { connectMailbox } from "@/testing/connect-helpers";
import * as server from "../server";
import { publishedToSalesInOrgB } from "./isolation-seeds";

// Org B's member switched org B's workflow on for their own inbox.
async function enabledInOrgB(orgs: TwoOrgs) {
  const { orgB } = orgs;
  const b = await publishedToSalesInOrgB(orgs);
  await connectMailbox(orgB.member.ctx, orgB.member.email);
  await server.enable(orgB.member.ctx, b.workflowId);
  return b;
}

export const enablementCases = {
  listEnablements: async (orgs: TwoOrgs) => {
    const b = await enabledInOrgB(orgs);

    await expect(server.listEnablements(orgs.orgA.admin.ctx, b.workflowId)).rejects.toThrow(
      NotFoundError,
    );
    expect(await server.listEnablements(orgs.orgB.admin.ctx, b.workflowId)).toHaveLength(1);
  },

  listOwnEnablements: async (orgs: TwoOrgs) => {
    await enabledInOrgB(orgs);

    for (const user of [orgs.orgA.admin, orgs.orgA.member]) {
      expect(await server.listOwnEnablements(user.ctx)).toEqual([]);
    }
    expect(await server.listOwnEnablements(orgs.orgB.member.ctx)).toHaveLength(1);
  },

  pausedText: notTenantScoped("It puts a pause reason in words, reading nothing."),
};
