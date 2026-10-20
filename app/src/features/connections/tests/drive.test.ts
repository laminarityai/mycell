// Google Drive as a source: connecting it (member and org), the account checks, and the
// lifecycle paths every source shares: reauthorizing and the nightly reconciliation.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { fakeNango } from "@/testing/fake-nango";
import {
  handleNangoWebhook,
  listConnections,
  reconcileConnections,
  startConnect,
  startReconnect,
} from "../server";
import type { ConnectionKind } from "../types";
import { connectGmail } from "@/testing/connect-helpers";

beforeEach(resetDatabase);

async function deliver(webhook: { rawBody: string; headers: Headers }) {
  return handleNangoWebhook(webhook.rawBody, webhook.headers);
}

async function connectDrive(ctx: Ctx, emailAddress: string, kind: ConnectionKind = "member") {
  const { token } = await startConnect(ctx, "drive", kind);
  const webhook = fakeNango.completeConnect(token, { emailAddress });
  return { ...webhook, response: await deliver(webhook) };
}

async function all(ctx: Ctx) {
  const listing = await listConnections(ctx);
  return [...listing.connections, ...listing.orgConnections];
}

describe("connecting Google Drive", () => {
  it("records a member connection through Nango's google-drive integration", async () => {
    const { orgA } = await seedTwoOrgs();

    const { response } = await connectDrive(orgA.member.ctx, orgA.member.email);

    expect(response).toEqual({ status: 200 });
    expect(fakeNango.lastSession().integration).toBe("google-drive");
    expect((await listConnections(orgA.member.ctx)).connections).toEqual([
      expect.objectContaining({
        source: "drive",
        kind: "member",
        accountEmail: orgA.member.email,
        status: "backfilling",
      }),
    ]);
  });

  it("refuses someone else's Drive, says why, and revokes it at Nango", async () => {
    const { orgA } = await seedTwoOrgs();

    const { connectionId } = await connectDrive(orgA.member.ctx, orgA.admin.email);

    const listing = await listConnections(orgA.member.ctx);
    expect(listing.connections).toEqual([]);
    expect(listing.attempts).toEqual([
      expect.objectContaining({ source: "drive", status: "refused" }),
    ]);
    expect(listing.attempts[0]?.refusal).toContain(orgA.admin.email);
    expect(fakeNango.hasConnection(connectionId)).toBe(false);
  });

  it("lets the same account connect Gmail and Drive, but not Drive twice", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email);
    await connectDrive(orgA.member.ctx, orgA.member.email);

    const second = await connectDrive(orgA.member.ctx, orgA.member.email);

    expect((await all(orgA.member.ctx)).map((c) => c.source).sort()).toEqual(["drive", "gmail"]);
    const refused = (await listConnections(orgA.member.ctx)).attempts;
    expect(refused).toEqual([expect.objectContaining({ source: "drive", status: "refused" })]);
    expect(fakeNango.hasConnection(second.connectionId)).toBe(false);
  });

  it("lets admins connect an org Drive in the Workspace domain, and nobody else", async () => {
    const { orgA } = await seedTwoOrgs();
    const shared = `shared@${orgA.workspaceDomain}`;

    await expect(startConnect(orgA.member.ctx, "drive", "org")).rejects.toThrow(ForbiddenError);
    await connectDrive(orgA.admin.ctx, "someone@elsewhere.example", "org");
    await connectDrive(orgA.admin.ctx, shared, "org");

    const listing = await listConnections(orgA.admin.ctx);
    expect(listing.orgConnections).toEqual([
      expect.objectContaining({ source: "drive", kind: "org", accountEmail: shared }),
    ]);
    expect(listing.attempts).toEqual([
      expect.objectContaining({ source: "drive", kind: "org", status: "refused" }),
    ]);
  });
});

describe("a Drive connection's lifecycle", () => {
  it("needs reauth after a failed refresh, and a reconnect to the same account restores it", async () => {
    const { orgA } = await seedTwoOrgs();
    const { connectionId } = await connectDrive(orgA.member.ctx, orgA.member.email);
    await deliver(fakeNango.authWebhook(connectionId, "refresh", false));
    const [connection] = await all(orgA.member.ctx);
    expect(connection).toMatchObject({ status: "needs_reauth" });

    const { token } = await startReconnect(orgA.member.ctx, connection.id);
    expect(fakeNango.reconnectSessionsCreated()).toEqual([
      { token, connectionId, integration: "google-drive" },
    ]);
    await deliver(fakeNango.completeReconnect(token));

    expect((await all(orgA.member.ctx)).map((c) => c.status)).toEqual(["active"]);
  });

  it("keeps needing reauth when the reconnect reached a different Drive account", async () => {
    const { orgA } = await seedTwoOrgs();
    const { connectionId } = await connectDrive(orgA.member.ctx, orgA.member.email);
    await deliver(fakeNango.authWebhook(connectionId, "refresh", false));
    const [connection] = await all(orgA.member.ctx);

    const { token } = await startReconnect(orgA.member.ctx, connection.id);
    await deliver(fakeNango.completeReconnect(token, { emailAddress: "other@else.example" }));

    expect((await all(orgA.member.ctx)).map((c) => c.status)).toEqual(["needs_reauth"]);
  });

  it("is deleted by the nightly reconciliation once Nango no longer has it", async () => {
    const { orgA } = await seedTwoOrgs();
    const { connectionId } = await connectDrive(orgA.member.ctx, orgA.member.email);
    const [connection] = await all(orgA.member.ctx);
    fakeNango.deleteWithoutWebhook(connectionId);

    const summary = await reconcileConnections();

    expect(summary.deletedRows).toEqual([{ orgId: orgA.id, connectionId: connection.id }]);
    expect(await all(orgA.member.ctx)).toEqual([]);
  });

  it("is kept by the reconciliation while Nango still has it", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectDrive(orgA.member.ctx, orgA.member.email);

    const summary = await reconcileConnections();

    expect(summary.deletedRows).toEqual([]);
    expect(summary.deletedAtNango).toEqual([]);
    expect((await all(orgA.member.ctx)).map((c) => c.source)).toEqual(["drive"]);
  });
});
