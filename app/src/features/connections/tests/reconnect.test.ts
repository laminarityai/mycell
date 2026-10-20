// Re-authorizing a connection: Nango's refresh and override webhooks, and who may reconnect.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { seedUserWithoutOrg } from "@/db/testing/seed-user";
import { findCtx, setRole, signIn } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { fakeNango } from "@/testing/fake-nango";
import { handleNangoWebhook, listConnections, startReconnect } from "../server";
import { connectGmail, connectOrgInbox } from "@/testing/connect-helpers";

beforeEach(resetDatabase);

async function deliver(webhook: { rawBody: string; headers: Headers }) {
  return handleNangoWebhook(webhook.rawBody, webhook.headers);
}

// The status of the caller's one connection (their own, or the org's).
async function statusOf(ctx: Ctx) {
  const listing = await listConnections(ctx);
  return [...listing.connections, ...listing.orgConnections].map((c) => ({
    id: c.id,
    status: c.status,
  }));
}

async function idOf(ctx: Ctx) {
  const first = (await statusOf(ctx)).at(0);
  if (first === undefined) throw new Error("Nothing connected");
  return first.id;
}

describe("Nango's credential webhooks", () => {
  it("marks a connection still backfilling as needing reauth too", async () => {
    const { orgA } = await seedTwoOrgs();
    const { connectionId } = await connectGmail(orgA.member.ctx, orgA.member.email);

    await deliver(fakeNango.authWebhook(connectionId, "refresh", false));

    expect(await statusOf(orgA.member.ctx)).toEqual([
      { id: expect.any(String) as string, status: "needs_reauth" },
    ]);
  });

  it("leaves other statuses alone on a successful refresh or override", async () => {
    const { orgA } = await seedTwoOrgs();
    const { connectionId } = await connectGmail(orgA.member.ctx, orgA.member.email);

    await deliver(fakeNango.authWebhook(connectionId, "refresh", true));
    await deliver(fakeNango.authWebhook(connectionId, "override", true));

    expect((await statusOf(orgA.member.ctx)).map((c) => c.status)).toEqual(["backfilling"]);
  });

  it("changes nothing when forged, or naming a connection Mycel doesn't have", async () => {
    const { orgA } = await seedTwoOrgs();
    const { connectionId } = await connectGmail(orgA.member.ctx, orgA.member.email);
    const real = JSON.parse(fakeNango.authWebhook(connectionId, "refresh", false).rawBody) as {
      tags: Record<string, string>;
    };

    const forged = fakeNango.signed({ ...real, connectionId }, "not-nangos-key");
    expect(await deliver(forged)).toEqual({ status: 401 });
    const unknown = fakeNango.signed({ ...real, connectionId: "someone-elses" });
    expect(await deliver(unknown)).toEqual({ status: 200 });
    const untagged = fakeNango.signed({ ...real, connectionId, tags: {} });
    expect(await deliver(untagged)).toEqual({ status: 200 });

    expect((await statusOf(orgA.member.ctx)).map((c) => c.status)).toEqual(["backfilling"]);
  });
});

describe("startReconnect", () => {
  it("keeps needing reauth when the reconnect chose a different Google account", async () => {
    const { orgA } = await seedTwoOrgs();
    const { connectionId } = await connectGmail(orgA.member.ctx, orgA.member.email);
    await deliver(fakeNango.authWebhook(connectionId, "refresh", false));

    const { token } = await startReconnect(orgA.member.ctx, await idOf(orgA.member.ctx));
    await deliver(fakeNango.completeReconnect(token, { emailAddress: "someone@else.example" }));

    expect((await statusOf(orgA.member.ctx)).map((c) => c.status)).toEqual(["needs_reauth"]);
  });

  it("opens a Nango reconnect session for the connection", async () => {
    const { orgA } = await seedTwoOrgs();
    const { connectionId } = await connectGmail(orgA.member.ctx, orgA.member.email);

    const { token } = await startReconnect(orgA.member.ctx, await idOf(orgA.member.ctx));

    expect(fakeNango.reconnectSessionsCreated()).toEqual([
      { token, connectionId, integration: "google" },
    ]);
  });

  it("lets only a member connection's owner reconnect it", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email);
    const id = await idOf(orgA.member.ctx);
    const bob = await seedUserWithoutOrg(`bob@${orgA.workspaceDomain}`);
    const bobCtx = await signIn({ userId: bob.id, hd: orgA.workspaceDomain });

    await expect(startReconnect(orgA.admin.ctx, id)).rejects.toThrow(ForbiddenError);
    await expect(startReconnect(bobCtx, id)).rejects.toThrow(ForbiddenError);
    expect(fakeNango.reconnectSessionsCreated()).toEqual([]);
  });

  it("lets any admin, and no member, reconnect an org connection", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectOrgInbox(orgA.admin.ctx, `support@${orgA.workspaceDomain}`);
    const id = await idOf(orgA.admin.ctx);
    const carol = await seedUserWithoutOrg(`carol@${orgA.workspaceDomain}`);
    await signIn({ userId: carol.id, hd: orgA.workspaceDomain });
    await setRole(orgA.admin.ctx, carol.id, "admin");
    const carolCtx = await findCtx(carol.id);
    if (carolCtx === undefined) throw new Error("Carol didn't join");

    await expect(startReconnect(orgA.member.ctx, id)).rejects.toThrow(ForbiddenError);
    expect(await startReconnect(carolCtx, id)).toEqual({ token: expect.any(String) as string });
  });

  it("is NotFoundError for a connection that doesn't exist", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(startReconnect(orgA.member.ctx, "nope")).rejects.toThrow(NotFoundError);
  });
});
