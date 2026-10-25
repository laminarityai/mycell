import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle, deliver } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import * as server from "../server";
import { pauseFailing, publishLabels } from "@/testing/paused-workflow-helpers";

// Org A is funded and has nothing wrong. Org B is out of credits, its shared inbox and its
// admin's own connection need reconnecting, and a workflow is paused for failing, so org B's
// admin has four alerts.
async function seedOrgBAlerts({ orgA, orgB }: TwoOrgs) {
  await grantCredits(systemCtx(orgA.id), 1000, "October allowance");
  const shared = await connectGoogle(orgB.admin.ctx, `support@${orgB.workspaceDomain}`, {
    kind: "org",
  });
  const own = await connectGoogle(orgB.admin.ctx, orgB.admin.email);
  await pauseFailing(orgB.id, await publishLabels(orgB.admin.ctx, "Pricing labels"));
  for (const connection of [shared, own]) {
    await deliver(fakeNango.authWebhook(connection.nangoConnectionId, "refresh", false));
  }
  expect(await server.countAlerts(orgB.admin.ctx)).toBe(4);
}

export const isolationCases = defineIsolationCases(server, {
  listAlerts: async (orgs) => {
    await seedOrgBAlerts(orgs);

    expect(await server.listAlerts(orgs.orgA.admin.ctx)).toEqual([]);
  },

  countAlerts: async (orgs) => {
    await seedOrgBAlerts(orgs);

    expect(await server.countAlerts(orgs.orgA.admin.ctx)).toBe(0);
  },
});
