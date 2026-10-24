// The connections a person is the one to fix: their own that need reconnecting or whose
// backfill failed, and, for an admin, the org's.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle, deliver } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { listConnectionsToFix, recordIngestState } from "../server";

beforeEach(resetDatabase);

describe("listConnectionsToFix", () => {
  it("lists the caller's own and, for an admin, the org's, never a colleague's", async () => {
    const { orgA } = await seedTwoOrgs();
    const mine = await connectGoogle(orgA.admin.ctx, orgA.admin.email);
    const shared = await connectGoogle(orgA.admin.ctx, `support@${orgA.workspaceDomain}`, {
      kind: "org",
    });
    const theirs = await connectGoogle(orgA.member.ctx, orgA.member.email);
    // A shared inbox that is fine, and so isn't listed.
    await connectGoogle(orgA.admin.ctx, `sales@${orgA.workspaceDomain}`, {
      kind: "org",
    });
    for (const connection of [mine, theirs]) {
      await deliver(fakeNango.authWebhook(connection.nangoConnectionId, "refresh", false));
    }
    // Discovery gave up on its backfill.
    await recordIngestState(systemCtx(orgA.id), shared.id, "gmail", { status: "failed" });

    expect(await listConnectionsToFix(orgA.admin.ctx)).toEqual([
      {
        id: mine.id,
        source: "google",
        kind: "member",
        accountEmail: orgA.admin.email,
        status: "needs_reauth",
      },
      {
        id: shared.id,
        source: "google",
        kind: "org",
        accountEmail: `support@${orgA.workspaceDomain}`,
        status: "failed",
      },
    ]);
    expect(await listConnectionsToFix(orgA.member.ctx)).toEqual([
      expect.objectContaining({ id: theirs.id, status: "needs_reauth" }),
    ]);
  });

  it("names one that needs reconnecting as such even when its backfill failed too", async () => {
    const { orgA } = await seedTwoOrgs();
    const mine = await connectGoogle(orgA.admin.ctx, orgA.admin.email);
    await recordIngestState(orgA.admin.ctx, mine.id, "gmail", { status: "failed" });
    await deliver(fakeNango.authWebhook(mine.nangoConnectionId, "refresh", false));

    expect(await listConnectionsToFix(orgA.admin.ctx)).toEqual([
      expect.objectContaining({ id: mine.id, status: "needs_reauth" }),
    ]);
  });
});
