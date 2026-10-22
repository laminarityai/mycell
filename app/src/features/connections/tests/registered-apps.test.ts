// Connecting a registered app other than Google (ADR-0018), the way Google is connected
// (ADR-0014): one connection per account and app, member or org, with what was granted, through
// the fake Nango and its fake Pipedrive.
import { z } from "zod";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { fakeInngest } from "@/testing/fake-inngest";
import { fakeNango } from "@/testing/fake-nango";
import { connectApp, connectGmail, deliver } from "@/testing/connect-helpers";
import { REGISTERED_APPS } from "../registered-apps";
import {
  disconnect,
  getConnection,
  listConnections,
  proxyGet,
  reconcileConnections,
  startConnect,
  startReconnect,
} from "../server";

beforeEach(resetDatabase);

const PIPEDRIVE_SCOPES = REGISTERED_APPS.pipedrive.scopes;

// The caller's connections and the org's, as the connections page lists them.
async function allListed(ctx: Ctx) {
  const listing = await listConnections(ctx);
  return [...listing.connections, ...listing.orgConnections];
}

// Connects the account's Pipedrive, which must be recorded.
async function connectPipedrive(
  ctx: Ctx,
  emailAddress: string,
  options: Parameters<typeof connectApp>[3] = {},
) {
  const connected = await connectApp(ctx, "pipedrive", emailAddress, options);
  if (connected.id === undefined) throw new Error(`${emailAddress}'s Pipedrive didn't connect`);
  return { ...connected, id: connected.id };
}

describe("connecting Pipedrive", () => {
  it("records a member's own Pipedrive account, with the permissions it was granted", async () => {
    const { orgA } = await seedTwoOrgs();

    const { response } = await connectApp(orgA.member.ctx, "pipedrive", orgA.member.email);

    expect(response).toEqual({ status: 200 });
    const listing = await listConnections(orgA.member.ctx);
    expect(listing.attempts).toEqual([]);
    expect(listing.connections).toEqual([
      expect.objectContaining({
        source: "pipedrive",
        kind: "member",
        accountEmail: orgA.member.email,
        status: "active",
        grantedScopes: [...PIPEDRIVE_SCOPES],
        apps: [],
        missingApps: [],
      }),
    ]);
  });

  it("asks Nango for a session on the app's own integration", async () => {
    const { orgA } = await seedTwoOrgs();

    await startConnect(orgA.member.ctx, "pipedrive");

    expect(fakeNango.lastSession().integration).toBe(REGISTERED_APPS.pipedrive.integration);
  });

  it("records only the permissions the account granted", async () => {
    const { orgA } = await seedTwoOrgs();

    await connectPipedrive(orgA.member.ctx, orgA.member.email, {
      scopes: ["base", "deals:full"],
    });

    expect((await listConnections(orgA.member.ctx)).connections).toEqual([
      expect.objectContaining({ grantedScopes: ["base", "deals:full"] }),
    ]);
  });

  it("lets an admin connect a shared account in the Workspace domain as an org connection", async () => {
    const { orgA } = await seedTwoOrgs();
    const sales = `sales@${orgA.workspaceDomain}`;

    await connectPipedrive(orgA.admin.ctx, sales, { kind: "org" });

    const listing = await listConnections(orgA.admin.ctx);
    expect(listing.connections).toEqual([]);
    expect(listing.orgConnections).toEqual([
      expect.objectContaining({
        source: "pipedrive",
        kind: "org",
        accountEmail: sales,
        grantedScopes: [...PIPEDRIVE_SCOPES],
        owner: { userId: orgA.admin.id, removed: false, name: expect.any(String) as string },
      }),
    ]);
    // A member sees no org connection.
    expect(await allListed(orgA.member.ctx)).toEqual([]);
  });

  it("refuses a member starting an org connection", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(startConnect(orgA.member.ctx, "pipedrive", "org")).rejects.toThrow(ForbiddenError);
  });

  it("refuses someone else's account, says why, and revokes it at Nango", async () => {
    const { orgA } = await seedTwoOrgs();

    const { connectionId, id } = await connectApp(orgA.member.ctx, "pipedrive", orgA.admin.email);

    expect(id).toBeUndefined();
    const listing = await listConnections(orgA.member.ctx);
    expect(listing.attempts).toEqual([
      expect.objectContaining({ source: "pipedrive", status: "refused" }),
    ]);
    expect(listing.attempts[0]?.refusal).toContain(orgA.admin.email);
    expect(fakeNango.hasConnection(connectionId)).toBe(false);
  });

  it("keeps one connection per account and app", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email);
    const first = await connectPipedrive(orgA.member.ctx, orgA.member.email);

    const second = await connectApp(orgA.member.ctx, "pipedrive", orgA.member.email);

    const { connections, attempts } = await listConnections(orgA.member.ctx);
    expect(connections.map((c) => c.source).sort()).toEqual(["google", "pipedrive"]);
    expect(attempts).toEqual([
      expect.objectContaining({ refusal: `${orgA.member.email} is already connected.` }),
    ]);
    expect(fakeNango.hasConnection(first.connectionId)).toBe(true);
    expect(fakeNango.hasConnection(second.connectionId)).toBe(false);
  });

  it("starts no backfill: the app isn't a discovery source", async () => {
    const { orgA } = await seedTwoOrgs();

    const { id } = await connectPipedrive(orgA.member.ctx, orgA.member.email);

    expect(fakeInngest.sent("connections/connection.recorded")).toEqual([]);
    expect(await getConnection(orgA.member.ctx, id)).toMatchObject({ apps: [], ingest: {} });
  });

  it("reads the app through its own integration, on the company's host", async () => {
    const { orgA } = await seedTwoOrgs();
    const { id, connectionId } = await connectPipedrive(orgA.member.ctx, orgA.member.email);
    const app = fakeNango.pipedrive(connectionId);
    const before = app.requests.length;

    const me = await proxyGet(
      orgA.member.ctx,
      id,
      "/v1/users/me",
      z.object({ data: z.object({ email: z.string() }) }),
    );

    expect(me?.data.email).toBe(orgA.member.email);
    expect(app.requests.slice(before)).toEqual([
      { method: "GET", path: "/v1/users/me", query: {}, body: undefined },
    ]);
  });
});

describe("disconnecting and reconnecting Pipedrive", () => {
  it("deletes the connection here and at Nango, and only its owner may", async () => {
    const { orgA } = await seedTwoOrgs();
    const { id, connectionId } = await connectPipedrive(orgA.member.ctx, orgA.member.email);

    await expect(disconnect(orgA.admin.ctx, id)).rejects.toThrow(ForbiddenError);
    await disconnect(orgA.member.ctx, id);

    expect(await allListed(orgA.member.ctx)).toEqual([]);
    expect(fakeNango.hasConnection(connectionId)).toBe(false);
    await expect(getConnection(orgA.member.ctx, id)).rejects.toThrow(NotFoundError);
  });

  it("forgets a connection Nango deleted, by webhook or found by reconciliation", async () => {
    const { orgA } = await seedTwoOrgs();
    const own = await connectPipedrive(orgA.member.ctx, orgA.member.email);
    const shared = await connectPipedrive(orgA.admin.ctx, `sales@${orgA.workspaceDomain}`, {
      kind: "org",
    });

    await deliver(fakeNango.deleteOutsideMycel(own.connectionId));
    fakeNango.deleteWithoutWebhook(shared.connectionId);
    const summary = await reconcileConnections();

    expect(summary.deletedRows).toEqual([{ orgId: orgA.id, connectionId: shared.id }]);
    expect(await allListed(orgA.member.ctx)).toEqual([]);
    expect(await allListed(orgA.admin.ctx)).toEqual([]);
  });

  it("reconnects through the app's integration and records what the reconnect granted", async () => {
    const { orgA } = await seedTwoOrgs();
    const { id, connectionId } = await connectPipedrive(orgA.member.ctx, orgA.member.email);
    await deliver(fakeNango.authWebhook(connectionId, "refresh", false));
    expect((await allListed(orgA.member.ctx)).map((c) => c.status)).toEqual(["needs_reauth"]);

    const { token } = await startReconnect(orgA.member.ctx, id);
    expect(fakeNango.reconnectSessionsCreated().at(-1)).toMatchObject({
      connectionId,
      integration: "pipedrive",
    });
    await deliver(fakeNango.completeReconnect(token, undefined, ["base", "deals:read"]));

    expect(await allListed(orgA.member.ctx)).toEqual([
      expect.objectContaining({ status: "active", grantedScopes: ["base", "deals:read"] }),
    ]);
  });

  it("keeps waiting on a reconnect that picked another Pipedrive account", async () => {
    const { orgA } = await seedTwoOrgs();
    const { id } = await connectPipedrive(orgA.member.ctx, orgA.member.email);

    const { token } = await startReconnect(orgA.member.ctx, id);
    await deliver(fakeNango.completeReconnect(token, { emailAddress: orgA.admin.email }));

    expect(await allListed(orgA.member.ctx)).toEqual([
      expect.objectContaining({ status: "needs_reauth", accountEmail: orgA.member.email }),
    ]);
  });
});

describe("another company's Pipedrive connection", () => {
  it("is not found, and left as it was", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const theirs = await connectPipedrive(orgB.member.ctx, orgB.member.email);
    const shared = await connectPipedrive(orgB.admin.ctx, `sales@${orgB.workspaceDomain}`, {
      kind: "org",
    });
    const before = await listConnections(orgB.admin.ctx);

    for (const id of [theirs.id, shared.id]) {
      for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
        await expect(disconnect(ctx, id)).rejects.toThrow(NotFoundError);
        await expect(startReconnect(ctx, id)).rejects.toThrow(NotFoundError);
        await expect(getConnection(ctx, id)).rejects.toThrow(NotFoundError);
        await expect(proxyGet(ctx, id, "/v1/users/me", z.unknown())).rejects.toThrow(NotFoundError);
      }
    }

    expect(await allListed(orgA.admin.ctx)).toEqual([]);
    expect(await listConnections(orgB.admin.ctx)).toEqual(before);
    expect(fakeNango.hasConnection(theirs.connectionId)).toBe(true);
  });
});
