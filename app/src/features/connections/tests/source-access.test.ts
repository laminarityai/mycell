import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { fakeInngest } from "@/testing/fake-inngest";
import { fakeNango } from "@/testing/fake-nango";
import {
  disconnect,
  getConnection,
  handleNangoWebhook,
  listConnections,
  listConnectionsForJobs,
  proxyGet,
  recordIngestState,
  startConnect,
} from "../server";
import { GOOGLE_APP_SCOPES } from "../types";
import { connectGmail, connectOrgInbox } from "@/testing/connect-helpers";

beforeEach(resetDatabase);

const profile = z.object({ emailAddress: z.string(), historyId: z.string() });
const message = z.object({ id: z.string() });

async function ownConnectionId(ctx: Parameters<typeof listConnections>[0]) {
  const listing = await listConnections(ctx);
  const id = [...listing.connections, ...listing.orgConnections].at(0)?.id;
  if (id === undefined) throw new Error("Nothing connected");
  return id;
}

describe("recording a connection", () => {
  it("starts it backfilling and sends the event that runs the backfill", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email);
    const id = await ownConnectionId(orgA.member.ctx);

    const backfilling = {
      status: "backfilling",
      cursor: null,
      backfilledItems: 0,
      lastPolledAt: null,
    };
    expect(await getConnection(orgA.member.ctx, id)).toEqual({
      id,
      source: "google",
      kind: "member",
      ownerUserId: orgA.member.id,
      needsReauth: false,
      grantedScopes: Object.values(GOOGLE_APP_SCOPES),
      apps: ["gmail", "drive", "sheets", "calendar", "docs", "tasks"],
      ingest: { gmail: backfilling, drive: backfilling },
    });
    expect(fakeInngest.sent("connections/connection.recorded")).toHaveLength(1);
  });

  it("sends the event on Nango's redelivery when sending it failed the first time", async () => {
    const { orgA } = await seedTwoOrgs();
    const { token } = await startConnect(orgA.member.ctx, "google");
    const webhook = fakeNango.completeConnect(token, { emailAddress: orgA.member.email });
    fakeInngest.failSends();

    // The route answers 500, so Nango delivers the webhook again later.
    await expect(handleNangoWebhook(webhook.rawBody, webhook.headers)).rejects.toThrow();
    expect((await listConnections(orgA.member.ctx)).attempts).toEqual([
      expect.objectContaining({ status: "pending" }),
    ]);

    fakeInngest.failSends(false);
    await handleNangoWebhook(webhook.rawBody, webhook.headers);
    // Once settled, a further redelivery changes nothing.
    await handleNangoWebhook(webhook.rawBody, webhook.headers);

    const listing = await listConnections(orgA.member.ctx);
    expect(listing.attempts).toEqual([]);
    expect(listing.connections).toHaveLength(1);
    expect(fakeInngest.sent("connections/connection.recorded")).toEqual([
      expect.objectContaining({ id: `connection-recorded-${listing.connections[0]?.id ?? ""}` }),
    ]);
  });
});

describe("getConnection", () => {
  it("refuses a connection that isn't the caller's to read", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email);
    await connectOrgInbox(orgA.admin.ctx, `support@${orgA.workspaceDomain}`);
    const members = await ownConnectionId(orgA.member.ctx);
    const orgs = await ownConnectionId(orgA.admin.ctx);

    await expect(getConnection(orgA.admin.ctx, members)).rejects.toThrow(ForbiddenError);
    await expect(getConnection(orgA.member.ctx, orgs)).rejects.toThrow(ForbiddenError);
    expect(await getConnection(orgA.admin.ctx, orgs)).toMatchObject({ kind: "org" });
  });
});

describe("proxyGet", () => {
  it("reads the connection's source through Nango, null for an item it doesn't have", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email);
    const id = await ownConnectionId(orgA.member.ctx);

    expect(
      await proxyGet(orgA.member.ctx, id, "/gmail/v1/users/me/profile", profile),
    ).toMatchObject({ emailAddress: orgA.member.email });
    expect(
      await proxyGet(orgA.member.ctx, id, "/gmail/v1/users/me/messages/nope?format=full", message),
    ).toBeNull();
  });

  it("turns a connection Nango no longer has, or Mycel no longer has, into not found", async () => {
    const { orgA } = await seedTwoOrgs();
    const { connectionId: nangoId } = await connectGmail(orgA.member.ctx, orgA.member.email);
    const id = await ownConnectionId(orgA.member.ctx);
    // Deleted at Nango without the webhook having arrived yet.
    fakeNango.deleteOutsideMycel(nangoId);

    const path = "/gmail/v1/users/me/profile";
    await expect(proxyGet(orgA.member.ctx, id, path, profile)).rejects.toThrow(NotFoundError);
    await disconnect(orgA.member.ctx, id);
    await expect(proxyGet(orgA.member.ctx, id, path, profile)).rejects.toThrow(NotFoundError);
  });
});

describe("recordIngestState", () => {
  it("shows each app's status and progress, summed up, on the connections page", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email);
    const id = await ownConnectionId(orgA.member.ctx);

    await recordIngestState(orgA.member.ctx, id, "gmail", { backfilledItems: 40, cursor: "1234" });
    await recordIngestState(orgA.member.ctx, id, "drive", { backfilledItems: 2 });
    expect((await listConnections(orgA.member.ctx)).connections).toEqual([
      expect.objectContaining({ status: "backfilling", backfilledItems: 42 }),
    ]);

    await recordIngestState(orgA.member.ctx, id, "gmail", { status: "active" });
    expect(await getConnection(orgA.member.ctx, id)).toMatchObject({
      ingest: { gmail: { status: "active", cursor: "1234" }, drive: { status: "backfilling" } },
    });
    expect((await listConnections(orgA.member.ctx)).connections).toEqual([
      expect.objectContaining({ status: "backfilling" }),
    ]);

    await recordIngestState(orgA.member.ctx, id, "drive", { status: "failed" });
    expect((await listConnections(orgA.member.ctx)).connections).toEqual([
      expect.objectContaining({ status: "failed" }),
    ]);
  });

  it("is NotFoundError for an app the connection wasn't granted", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email, [GOOGLE_APP_SCOPES.gmail]);
    const id = await ownConnectionId(orgA.member.ctx);

    await expect(
      recordIngestState(orgA.member.ctx, id, "drive", { status: "active" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses another member's connection", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email);
    const id = await ownConnectionId(orgA.member.ctx);

    await expect(
      recordIngestState(orgA.admin.ctx, id, "gmail", { status: "failed" }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("scheduled jobs' system ctx", () => {
  it("reads every connection in its org, member and org connections alike", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email);
    await connectOrgInbox(orgA.admin.ctx, `support@${orgA.workspaceDomain}`);
    const system = systemCtx(orgA.id);

    const listed = await listConnectionsForJobs(system);

    expect(listed.map((c) => c.kind).sort()).toEqual(["member", "org"]);
    for (const connection of listed) {
      expect(
        await proxyGet(system, connection.id, "/gmail/v1/users/me/profile", profile),
      ).not.toBeNull();
    }
  });

  it("can't reach another org's connections", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    await connectGmail(orgB.member.ctx, orgB.member.email);
    const orgBConnection = await ownConnectionId(orgB.member.ctx);

    expect(await listConnectionsForJobs(systemCtx(orgA.id))).toEqual([]);
    await expect(getConnection(systemCtx(orgA.id), orgBConnection)).rejects.toThrow(NotFoundError);
  });

  it("is the only ctx that may list connections for jobs", async () => {
    const { orgA } = await seedTwoOrgs();

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      await expect(listConnectionsForJobs(ctx)).rejects.toThrow(ForbiddenError);
    }
  });

  it("passes no admin check", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(startConnect(systemCtx(orgA.id), "google", "org")).rejects.toThrow(ForbiddenError);
  });
});
