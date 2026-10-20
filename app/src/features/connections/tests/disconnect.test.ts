import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { removeUser, setRole } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { fakeNango } from "@/testing/fake-nango";
import {
  deleteMemberConnectionsOf,
  disconnect,
  handleNangoWebhook,
  listConnections,
} from "../server";
import { connectGmail, connectOrgInbox } from "./connect-helpers";

beforeEach(resetDatabase);

// Connects the caller's own Gmail, returning Mycel's connection ID and Nango's.
async function connectOwnGmail(ctx: Ctx, emailAddress: string) {
  const { connectionId: nangoConnectionId } = await connectGmail(ctx, emailAddress);
  const { connections } = await listConnections(ctx);
  const connection = connections.find((c) => c.accountEmail === emailAddress);
  if (connection === undefined) throw new Error(`${emailAddress} didn't connect`);
  return { id: connection.id, nangoConnectionId };
}

// Connects a shared inbox as an org connection, returning Mycel's connection ID and Nango's.
async function connectSharedInbox(ctx: Ctx, emailAddress: string) {
  const { connectionId: nangoConnectionId } = await connectOrgInbox(ctx, emailAddress);
  const { orgConnections } = await listConnections(ctx);
  const connection = orgConnections.find((c) => c.accountEmail === emailAddress);
  if (connection === undefined) throw new Error(`${emailAddress} didn't connect`);
  return { id: connection.id, nangoConnectionId };
}

describe("disconnect", () => {
  it("lets the owner disconnect their member connection, here and at Nango", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectOwnGmail(orgA.member.ctx, orgA.member.email);

    await disconnect(orgA.member.ctx, connection.id);

    expect((await listConnections(orgA.member.ctx)).connections).toEqual([]);
    expect(fakeNango.hasConnection(connection.nangoConnectionId)).toBe(false);
  });

  it("lets an admin disconnect their own member connection", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectOwnGmail(orgA.admin.ctx, orgA.admin.email);

    await disconnect(orgA.admin.ctx, connection.id);

    expect((await listConnections(orgA.admin.ctx)).connections).toEqual([]);
    expect(fakeNango.hasConnection(connection.nangoConnectionId)).toBe(false);
  });

  it("refuses an admin disconnecting a member's connection", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectOwnGmail(orgA.member.ctx, orgA.member.email);

    await expect(disconnect(orgA.admin.ctx, connection.id)).rejects.toThrow(ForbiddenError);

    expect((await listConnections(orgA.member.ctx)).connections).toHaveLength(1);
    expect(fakeNango.hasConnection(connection.nangoConnectionId)).toBe(true);
  });

  it("refuses a member disconnecting another user's connection", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectOwnGmail(orgA.admin.ctx, orgA.admin.email);

    await expect(disconnect(orgA.member.ctx, connection.id)).rejects.toThrow(ForbiddenError);

    expect((await listConnections(orgA.admin.ctx)).connections).toHaveLength(1);
  });

  it("treats another org's connection, or no connection, as not found", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const orgBConnection = await connectOwnGmail(orgB.member.ctx, orgB.member.email);
    const before = await listConnections(orgB.member.ctx);

    await expect(disconnect(orgA.admin.ctx, orgBConnection.id)).rejects.toThrow(NotFoundError);
    await expect(disconnect(orgA.member.ctx, "no-such-connection")).rejects.toThrow(NotFoundError);

    expect(await listConnections(orgB.member.ctx)).toEqual(before);
    expect(fakeNango.hasConnection(orgBConnection.nangoConnectionId)).toBe(true);
  });

  it("still forgets the connection when Nango's delete fails", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectOwnGmail(orgA.member.ctx, orgA.member.email);
    fakeNango.failDeletes();

    await disconnect(orgA.member.ctx, connection.id);

    expect((await listConnections(orgA.member.ctx)).connections).toEqual([]);
    // Left for reconciliation to delete.
    expect(fakeNango.hasConnection(connection.nangoConnectionId)).toBe(true);
  });

  it("succeeds when Nango already deleted the connection", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectOwnGmail(orgA.member.ctx, orgA.member.email);
    fakeNango.deleteOutsideMycel(connection.nangoConnectionId);

    await disconnect(orgA.member.ctx, connection.id);

    expect((await listConnections(orgA.member.ctx)).connections).toEqual([]);
  });
});

describe("Nango's deletion webhook", () => {
  it("forgets a connection deleted at Nango", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectOwnGmail(orgA.member.ctx, orgA.member.email);
    await connectOwnGmail(orgA.admin.ctx, orgA.admin.email);

    const webhook = fakeNango.deleteOutsideMycel(connection.nangoConnectionId);
    const response = await handleNangoWebhook(webhook.rawBody, webhook.headers);

    expect(response).toEqual({ status: 200 });
    expect((await listConnections(orgA.member.ctx)).connections).toEqual([]);
    expect((await listConnections(orgA.admin.ctx)).connections).toHaveLength(1);
  });

  it("ignores an unknown connection ID", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectOwnGmail(orgA.member.ctx, orgA.member.email);
    const before = await listConnections(orgA.member.ctx);
    const unknown = fakeNango.signed({
      type: "auth",
      operation: "deletion",
      success: true,
      connectionId: "unknown-nango-connection",
      providerConfigKey: "google-mail",
      tags: { mycel_attempt_id: "x", end_user_id: orgA.member.id, organization_id: orgA.id },
    });

    expect(await handleNangoWebhook(unknown.rawBody, unknown.headers)).toEqual({ status: 200 });

    expect(await listConnections(orgA.member.ctx)).toEqual(before);
  });

  it("rejects a forged deletion webhook and changes nothing", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectOwnGmail(orgA.member.ctx, orgA.member.email);
    const genuine = fakeNango.authWebhook(connection.nangoConnectionId, "deletion", true);
    const forged = fakeNango.signed(JSON.parse(genuine.rawBody), "not-the-signing-key");

    expect(await handleNangoWebhook(forged.rawBody, forged.headers)).toEqual({ status: 401 });

    expect((await listConnections(orgA.member.ctx)).connections).toHaveLength(1);
  });

  it("ignores a deletion that failed or names another integration", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectOwnGmail(orgA.member.ctx, orgA.member.email);
    const failed = fakeNango.authWebhook(connection.nangoConnectionId, "deletion", false);
    const otherIntegration = fakeNango.signed({
      ...JSON.parse(fakeNango.authWebhook(connection.nangoConnectionId, "deletion", true).rawBody),
      providerConfigKey: "google-drive",
    });

    for (const webhook of [failed, otherIntegration]) {
      expect(await handleNangoWebhook(webhook.rawBody, webhook.headers)).toEqual({ status: 200 });
    }

    expect((await listConnections(orgA.member.ctx)).connections).toHaveLength(1);
  });
});

describe("removing a user", () => {
  // What removeUserAction does: remove the user, then delete their member connections.
  async function removeUserAndConnections(ctx: Ctx, userId: string) {
    await removeUser(ctx, userId);
    await deleteMemberConnectionsOf(ctx, userId);
  }

  it("deletes their member connections here and at Nango, and nobody else's", async () => {
    const { orgA } = await seedTwoOrgs();
    const theirs = await connectOwnGmail(orgA.member.ctx, orgA.member.email);
    const mine = await connectOwnGmail(orgA.admin.ctx, orgA.admin.email);

    await removeUserAndConnections(orgA.admin.ctx, orgA.member.id);

    expect(fakeNango.hasConnection(theirs.nangoConnectionId)).toBe(false);
    expect(fakeNango.hasConnection(mine.nangoConnectionId)).toBe(true);
    expect((await listConnections(orgA.admin.ctx)).connections.map((c) => c.id)).toEqual([mine.id]);
    // Gone, not just unlisted: disconnecting it is "not found", not "forbidden".
    await expect(disconnect(orgA.admin.ctx, theirs.id)).rejects.toThrow(NotFoundError);
  });

  it("still deletes their connections when Nango's delete fails", async () => {
    const { orgA } = await seedTwoOrgs();
    const theirs = await connectOwnGmail(orgA.member.ctx, orgA.member.email);
    fakeNango.failDeletes();

    await removeUserAndConnections(orgA.admin.ctx, orgA.member.id);

    await expect(disconnect(orgA.admin.ctx, theirs.id)).rejects.toThrow(NotFoundError);
  });

  it("refuses deleting the connections of a user who is still a member", async () => {
    const { orgA } = await seedTwoOrgs();
    const theirs = await connectOwnGmail(orgA.member.ctx, orgA.member.email);

    await expect(deleteMemberConnectionsOf(orgA.admin.ctx, orgA.member.id)).rejects.toThrow(
      ConflictError,
    );

    expect((await listConnections(orgA.member.ctx)).connections).toHaveLength(1);
    expect(fakeNango.hasConnection(theirs.nangoConnectionId)).toBe(true);
  });

  it("refuses a member", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectOwnGmail(orgA.admin.ctx, orgA.admin.email);

    await expect(deleteMemberConnectionsOf(orgA.member.ctx, orgA.admin.id)).rejects.toThrow(
      ForbiddenError,
    );

    expect((await listConnections(orgA.admin.ctx)).connections).toHaveLength(1);
  });
});

describe("org connections", () => {
  it("lets any admin disconnect an org connection, here and at Nango", async () => {
    const { orgA } = await seedTwoOrgs();
    await setRole(orgA.admin.ctx, orgA.member.id, "admin");
    const otherAdmin = { ...orgA.member.ctx, role: "admin" as const };
    const inbox = await connectSharedInbox(otherAdmin, `support@${orgA.workspaceDomain}`);

    await disconnect(orgA.admin.ctx, inbox.id);

    expect((await listConnections(orgA.admin.ctx)).orgConnections).toEqual([]);
    expect(fakeNango.hasConnection(inbox.nangoConnectionId)).toBe(false);
  });

  it("refuses a member disconnecting an org connection", async () => {
    const { orgA } = await seedTwoOrgs();
    const inbox = await connectSharedInbox(orgA.admin.ctx, `support@${orgA.workspaceDomain}`);

    await expect(disconnect(orgA.member.ctx, inbox.id)).rejects.toThrow(ForbiddenError);

    expect((await listConnections(orgA.admin.ctx)).orgConnections).toHaveLength(1);
    expect(fakeNango.hasConnection(inbox.nangoConnectionId)).toBe(true);
  });

  it("keeps a removed user's org connections, flagged, while their own ones go", async () => {
    const { orgA } = await seedTwoOrgs();
    await setRole(orgA.admin.ctx, orgA.member.id, "admin");
    const leaving = { ...orgA.member.ctx, role: "admin" as const };
    const inbox = await connectSharedInbox(leaving, `support@${orgA.workspaceDomain}`);
    const own = await connectOwnGmail(leaving, orgA.member.email);

    await removeUser(orgA.admin.ctx, orgA.member.id);
    await deleteMemberConnectionsOf(orgA.admin.ctx, orgA.member.id);

    const listing = await listConnections(orgA.admin.ctx);
    expect(listing.orgConnections.map((c) => [c.id, c.owner.removed])).toEqual([[inbox.id, true]]);
    expect(listing.memberConnections).toEqual([]);
    expect(fakeNango.hasConnection(inbox.nangoConnectionId)).toBe(true);
    expect(fakeNango.hasConnection(own.nangoConnectionId)).toBe(false);
  });
});
