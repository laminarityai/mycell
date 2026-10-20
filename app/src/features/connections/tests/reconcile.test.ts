import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import type { Ctx } from "@/lib/ctx";
import { fakeNango } from "@/testing/fake-nango";
import { disconnect, listConnections, reconcileConnections, startConnect } from "../server";
import { connectGmail, connectOrgInbox } from "@/testing/connect-helpers";

beforeEach(resetDatabase);

const HOUR_MS = 60 * 60 * 1000;
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * HOUR_MS);

const NOTHING_DONE = { deletedRows: [], keptUnconfirmed: [], deletedAtNango: [], heldAtNango: [] };

// Every connection the caller's admin listing shows, own and org, by account address.
async function addresses(ctx: Ctx) {
  const listing = await listConnections(ctx);
  return [...listing.connections, ...listing.orgConnections, ...listing.memberConnections]
    .map((c) => ("accountEmail" in c ? c.accountEmail : c.owner.userId))
    .sort();
}

// A user opens Connect UI and finishes OAuth, but Nango's creation webhook never arrives:
// Nango has the connection, and Mycel only a pending attempt.
async function connectWithoutWebhook(ctx: Ctx, emailAddress: string) {
  const { token } = await startConnect(ctx, "gmail");
  return fakeNango.completeConnect(token, { emailAddress }).connectionId;
}

describe("reconcileConnections", () => {
  it("deletes a connection whose Nango connection went without a webhook", async () => {
    const { orgA } = await seedTwoOrgs();
    const { connectionId: nangoId } = await connectGmail(orgA.member.ctx, orgA.member.email);
    const connection = (await listConnections(orgA.member.ctx)).connections.at(0);
    fakeNango.deleteWithoutWebhook(nangoId);

    const summary = await reconcileConnections();

    expect(summary).toEqual({
      ...NOTHING_DONE,
      deletedRows: [{ orgId: orgA.id, connectionId: connection?.id }],
    });
    expect((await listConnections(orgA.member.ctx)).connections).toEqual([]);
  });

  it("deletes at Nango a connection Mycel has no connection for", async () => {
    const { orgA } = await seedTwoOrgs();
    const { connectionId: nangoId } = await connectGmail(orgA.member.ctx, orgA.member.email);
    const connection = (await listConnections(orgA.member.ctx)).connections.at(0);
    // Disconnecting while Nango's delete fails forgets the row and leaves Nango's connection.
    fakeNango.failDeletes();
    await disconnect(orgA.member.ctx, connection?.id ?? "");
    fakeNango.failDeletes(false);
    expect(fakeNango.hasConnection(nangoId)).toBe(true);

    const summary = await reconcileConnections();

    expect(summary).toEqual({
      ...NOTHING_DONE,
      deletedAtNango: [{ nangoConnectionId: nangoId, integration: "google-mail" }],
    });
    expect(fakeNango.hasConnection(nangoId)).toBe(false);
  });

  it("keeps a Nango connection whose connect attempt is under a day old, and not after", async () => {
    const { orgA } = await seedTwoOrgs();
    const nangoId = await connectWithoutWebhook(orgA.member.ctx, orgA.member.email);

    expect(await reconcileConnections(hoursFromNow(23))).toEqual(NOTHING_DONE);
    expect(fakeNango.hasConnection(nangoId)).toBe(true);

    const summary = await reconcileConnections(hoursFromNow(25));

    expect(summary.deletedAtNango).toEqual([
      { nangoConnectionId: nangoId, integration: "google-mail" },
    ]);
    expect(fakeNango.hasConnection(nangoId)).toBe(false);
  });

  it("leaves connections on both sides untouched, across two orgs", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const nangoIds = [
      (await connectGmail(orgA.member.ctx, orgA.member.email)).connectionId,
      (await connectOrgInbox(orgA.admin.ctx, `support@${orgA.workspaceDomain}`)).connectionId,
      (await connectGmail(orgB.member.ctx, orgB.member.email)).connectionId,
      (await connectOrgInbox(orgB.admin.ctx, `sales@${orgB.workspaceDomain}`)).connectionId,
    ];
    const before = [await addresses(orgA.admin.ctx), await addresses(orgB.admin.ctx)];
    expect(before.map((listed) => listed.length)).toEqual([2, 2]);

    expect(await reconcileConnections()).toEqual(NOTHING_DONE);

    expect([await addresses(orgA.admin.ctx), await addresses(orgB.admin.ctx)]).toEqual(before);
    expect(nangoIds.map((id) => fakeNango.hasConnection(id))).toEqual([true, true, true, true]);
  });

  it("reads every page of Nango's connections, however few each page holds", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email);
    await connectGmail(orgA.admin.ctx, orgA.admin.email);
    await connectGmail(orgB.member.ctx, orgB.member.email);
    await connectGmail(orgB.admin.ctx, orgB.admin.email);
    const { connectionId: last } = await connectGmail(orgA.member.ctx, "someone@else.example");
    // That last one was refused (not the member's address) and deleted at Nango; this one,
    // made after it, sits on the last page with no row.
    expect(fakeNango.hasConnection(last)).toBe(false);
    const orphan = await connectWithoutWebhook(orgB.member.ctx, orgB.member.email);
    fakeNango.capListPage(2);

    const summary = await reconcileConnections(hoursFromNow(25));

    expect(summary).toEqual({
      ...NOTHING_DONE,
      deletedAtNango: [{ nangoConnectionId: orphan, integration: "google-mail" }],
    });
    expect((await addresses(orgA.admin.ctx)).length).toBe(2);
    expect((await addresses(orgB.admin.ctx)).length).toBe(2);
  });
});

describe("reconcileConnections' bulk-delete safety", () => {
  it("keeps every row when Nango lists nothing but still has each connection", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const nangoIds = [
      (await connectGmail(orgA.member.ctx, orgA.member.email)).connectionId,
      (await connectGmail(orgB.member.ctx, orgB.member.email)).connectionId,
    ];
    const before = [await addresses(orgA.admin.ctx), await addresses(orgB.admin.ctx)];
    fakeNango.listNothing();

    const summary = await reconcileConnections();

    expect(summary.deletedRows).toEqual([]);
    expect(summary.keptUnconfirmed.map((c) => c.orgId).sort()).toEqual([orgA.id, orgB.id].sort());
    expect([await addresses(orgA.admin.ctx), await addresses(orgB.admin.ctx)]).toEqual(before);
    expect(nangoIds.map((id) => fakeNango.hasConnection(id))).toEqual([true, true]);
  });

  it("still deletes every row whose connection a bulk delete at Nango took", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const nangoIds = [
      (await connectGmail(orgA.member.ctx, orgA.member.email)).connectionId,
      (await connectGmail(orgA.admin.ctx, orgA.admin.email)).connectionId,
      (await connectGmail(orgB.member.ctx, orgB.member.email)).connectionId,
    ];
    for (const id of nangoIds) fakeNango.deleteWithoutWebhook(id);

    const summary = await reconcileConnections();

    expect(summary.deletedRows).toHaveLength(3);
    expect(await addresses(orgA.admin.ctx)).toEqual([]);
    expect(await addresses(orgB.admin.ctx)).toEqual([]);
  });

  it("holds deleting at Nango when most of what Nango lists has no Mycel connection", async () => {
    const { orgA } = await seedTwoOrgs();
    const kept = (await connectGmail(orgA.member.ctx, orgA.member.email)).connectionId;
    const strays: string[] = [];
    for (let i = 0; i < 11; i++) {
      strays.push(await connectWithoutWebhook(orgA.admin.ctx, orgA.admin.email));
    }

    const summary = await reconcileConnections(hoursFromNow(25));

    expect(summary.deletedAtNango).toEqual([]);
    expect(summary.heldAtNango.map((c) => c.nangoConnectionId).sort()).toEqual(strays.sort());
    expect([kept, ...strays].every((id) => fakeNango.hasConnection(id))).toBe(true);
  });
});
