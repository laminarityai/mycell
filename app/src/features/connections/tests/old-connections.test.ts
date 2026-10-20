// The one-app Gmail and Drive connections made before one Google connection per account
// (ADR-0014): they keep their own Nango integrations until connecting Google replaces them, and
// every lifecycle path still reaches them there.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { connectOldConnection, deliver, listed } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { disconnect, getGrantedScopes, reconcileConnections, startReconnect } from "../server";

beforeEach(resetDatabase);

const DRIVE_READONLY = "https://www.googleapis.com/auth/drive.readonly";

describe("an old Drive connection", () => {
  it("is listed with its one app, and nothing missing to reconnect for", async () => {
    const { orgA } = await seedTwoOrgs();

    const old = await connectOldConnection(orgA.member.ctx, "drive", orgA.member.email);

    expect(await listed(orgA.member.ctx, old.id)).toMatchObject({
      source: "drive",
      apps: ["drive"],
      missingApps: [],
    });
  });

  it("reconnects through its own integration, restoring it and recording its scopes", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = orgA.member.ctx;
    const old = await connectOldConnection(ctx, "drive", orgA.member.email);
    await deliver(fakeNango.authWebhook(old.nangoConnectionId, "refresh", false));
    expect(await listed(ctx, old.id)).toMatchObject({ status: "needs_reauth" });

    const { token } = await startReconnect(ctx, old.id);
    expect(fakeNango.reconnectSessionsCreated()).toEqual([
      { token, connectionId: old.nangoConnectionId, integration: "google-drive" },
    ]);
    await deliver(fakeNango.completeReconnect(token));

    expect(await listed(ctx, old.id)).toMatchObject({ status: "backfilling", apps: ["drive"] });
    expect(await getGrantedScopes(ctx, old.id)).toEqual([DRIVE_READONLY]);
  });

  it("is deleted at its own integration on disconnect", async () => {
    const { orgA } = await seedTwoOrgs();
    const old = await connectOldConnection(orgA.member.ctx, "drive", orgA.member.email);

    await disconnect(orgA.member.ctx, old.id);

    expect(fakeNango.hasConnection(old.nangoConnectionId)).toBe(false);
  });

  it("is deleted by the nightly reconciliation once Nango no longer has it, and kept while it does", async () => {
    const { orgA } = await seedTwoOrgs();
    const kept = await connectOldConnection(orgA.member.ctx, "gmail", orgA.member.email);
    const gone = await connectOldConnection(orgA.member.ctx, "drive", orgA.member.email);
    fakeNango.deleteWithoutWebhook(gone.nangoConnectionId);

    const summary = await reconcileConnections();

    expect(summary.deletedRows).toEqual([{ orgId: orgA.id, connectionId: gone.id }]);
    expect(summary.deletedAtNango).toEqual([]);
    expect(await listed(orgA.member.ctx, kept.id)).toMatchObject({ source: "gmail" });
  });
});
