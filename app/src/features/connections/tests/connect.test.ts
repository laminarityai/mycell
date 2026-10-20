import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { removeUser } from "@/features/orgs/server";
import { fakeNango } from "@/testing/fake-nango";
import { handleNangoWebhook, listConnections, startConnect } from "../server";
import { connectGmail } from "./connect-helpers";

beforeEach(resetDatabase);

describe("connecting your own Gmail", () => {
  it("records a member connection once Nango's creation webhook arrives", async () => {
    const { orgA } = await seedTwoOrgs();

    const { response } = await connectGmail(orgA.member.ctx, orgA.member.email);

    expect(response).toEqual({ status: 200 });
    const listing = await listConnections(orgA.member.ctx);
    expect(listing.attempts).toEqual([]);
    expect(listing.connections).toEqual([
      expect.objectContaining({
        source: "gmail",
        kind: "member",
        accountEmail: orgA.member.email,
        status: "backfilling",
      }),
    ]);
  });

  it("shows the attempt as connecting until the webhook arrives", async () => {
    const { orgA } = await seedTwoOrgs();

    await startConnect(orgA.member.ctx, "gmail");

    const listing = await listConnections(orgA.member.ctx);
    expect(listing.connections).toEqual([]);
    expect(listing.attempts).toEqual([
      expect.objectContaining({ source: "gmail", status: "pending", refusal: null }),
    ]);
  });

  it("asks Nango for a session limited to Gmail and tagged with the attempt's user and org", async () => {
    const { orgA } = await seedTwoOrgs();

    await startConnect(orgA.member.ctx, "gmail");

    const session = fakeNango.lastSession();
    expect(session.integration).toBe("google-mail");
    expect(session.tags).toMatchObject({
      end_user_id: orgA.member.id,
      end_user_email: orgA.member.email,
      organization_id: orgA.id,
    });
  });

  it("matches the account address case-insensitively", async () => {
    const { orgA } = await seedTwoOrgs();

    await connectGmail(orgA.member.ctx, orgA.member.email.toUpperCase());

    const { connections } = await listConnections(orgA.member.ctx);
    expect(connections.map((c) => c.accountEmail)).toEqual([orgA.member.email]);
  });

  it("refuses someone else's account, says why, and revokes it at Nango", async () => {
    const { orgA } = await seedTwoOrgs();

    const { connectionId } = await connectGmail(orgA.member.ctx, orgA.admin.email);

    const listing = await listConnections(orgA.member.ctx);
    expect(listing.connections).toEqual([]);
    expect(listing.attempts.map((a) => a.status)).toEqual(["refused"]);
    expect(listing.attempts[0]?.refusal).toContain(orgA.admin.email);
    expect(fakeNango.hasConnection(connectionId)).toBe(false);
  });

  it("refuses connecting the same account twice", async () => {
    const { orgA } = await seedTwoOrgs();
    const first = await connectGmail(orgA.member.ctx, orgA.member.email);

    const second = await connectGmail(orgA.member.ctx, orgA.member.email);

    const listing = await listConnections(orgA.member.ctx);
    expect(listing.connections).toHaveLength(1);
    expect(listing.attempts).toEqual([
      expect.objectContaining({
        status: "refused",
        refusal: `${orgA.member.email} is already connected.`,
      }),
    ]);
    expect(fakeNango.hasConnection(first.connectionId)).toBe(true);
    expect(fakeNango.hasConnection(second.connectionId)).toBe(false);
  });

  it("records a redelivered webhook only once", async () => {
    const { orgA } = await seedTwoOrgs();
    const webhook = await connectGmail(orgA.member.ctx, orgA.member.email);

    await handleNangoWebhook(webhook.rawBody, webhook.headers);

    expect((await listConnections(orgA.member.ctx)).connections).toHaveLength(1);
  });

  it("marks the attempt refused when Nango reports the authorisation failed", async () => {
    const { orgA } = await seedTwoOrgs();
    const { token } = await startConnect(orgA.member.ctx, "gmail");
    const { connectionId } = fakeNango.completeConnect(token, { emailAddress: orgA.member.email });
    const failed = fakeNango.authWebhook(connectionId, "creation", false);

    await handleNangoWebhook(failed.rawBody, failed.headers);

    const listing = await listConnections(orgA.member.ctx);
    expect(listing.connections).toEqual([]);
    expect(listing.attempts).toEqual([expect.objectContaining({ status: "refused" })]);
  });

  it("ignores a webhook for a user who was removed after starting", async () => {
    const { orgA } = await seedTwoOrgs();
    const { token } = await startConnect(orgA.member.ctx, "gmail");
    await removeUser(orgA.admin.ctx, orgA.member.id);
    const webhook = fakeNango.completeConnect(token, { emailAddress: orgA.member.email });

    expect(await handleNangoWebhook(webhook.rawBody, webhook.headers)).toEqual({ status: 200 });

    expect((await listConnections(orgA.admin.ctx)).connections).toEqual([]);
  });

  it("lists only the caller's own connections", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email);
    await connectGmail(orgA.admin.ctx, orgA.admin.email);

    const mine = await listConnections(orgA.member.ctx);

    expect(mine.connections.map((c) => c.accountEmail)).toEqual([orgA.member.email]);
  });
});

describe("handleNangoWebhook", () => {
  it("rejects a bad signature with 401 and changes nothing", async () => {
    const { orgA } = await seedTwoOrgs();
    const { token } = await startConnect(orgA.member.ctx, "gmail");
    const genuine = fakeNango.completeConnect(token, { emailAddress: orgA.member.email });
    const forged = fakeNango.signed(JSON.parse(genuine.rawBody), "not-the-signing-key");

    expect(await handleNangoWebhook(forged.rawBody, forged.headers)).toEqual({ status: 401 });
    expect(await handleNangoWebhook(genuine.rawBody, new Headers())).toEqual({ status: 401 });

    const listing = await listConnections(orgA.member.ctx);
    expect(listing.connections).toEqual([]);
    expect(listing.attempts).toEqual([expect.objectContaining({ status: "pending" })]);
  });

  it("ignores webhooks naming no attempt, other types, and bodies that aren't JSON", async () => {
    const { orgA } = await seedTwoOrgs();
    await startConnect(orgA.member.ctx, "gmail");
    const unknownAttempt = fakeNango.signed({
      type: "auth",
      operation: "creation",
      success: true,
      connectionId: "nango-connection",
      providerConfigKey: "google-mail",
      tags: { mycel_attempt_id: "nope", end_user_id: orgA.member.id, organization_id: orgA.id },
    });
    const syncWebhook = fakeNango.signed({ type: "sync", connectionId: "x" });
    const notJson = fakeNango.signed("not json");
    notJson.rawBody = "{not json";
    const notJsonSigned = { ...fakeNango.signed(null), rawBody: "{not json" };

    for (const webhook of [unknownAttempt, syncWebhook]) {
      expect(await handleNangoWebhook(webhook.rawBody, webhook.headers)).toEqual({ status: 200 });
    }
    expect(await handleNangoWebhook(notJsonSigned.rawBody, notJsonSigned.headers)).toEqual({
      status: 401,
    });

    const listing = await listConnections(orgA.member.ctx);
    expect(listing.connections).toEqual([]);
    expect(listing.attempts).toEqual([expect.objectContaining({ status: "pending" })]);
  });
});
