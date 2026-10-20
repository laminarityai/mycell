// One Google connection per account (ADR-0014): one Nango integration asking for every Google
// app, the apps the account actually allowed, and reconnecting to allow the ones it didn't.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { connectGmail, connectGoogle, deliver, listed } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { fakeNango } from "@/testing/fake-nango";
import { getGrantedScopes, listConnections, startConnect, startReconnect } from "../server";
import { GOOGLE_APP_SCOPES, type GoogleApp } from "../types";

beforeEach(resetDatabase);

const ALL_SCOPES = Object.values(GOOGLE_APP_SCOPES);

function allScopesBut(...apps: GoogleApp[]): string[] {
  return Object.entries(GOOGLE_APP_SCOPES).flatMap(([app, scope]) =>
    apps.includes(app as GoogleApp) ? [] : [scope],
  );
}

describe("connecting Google", () => {
  it("opens one session on Nango's google integration", async () => {
    const { orgA } = await seedTwoOrgs();

    await startConnect(orgA.member.ctx, "google");

    expect(fakeNango.lastSession().integration).toBe("google");
  });

  it("records the scopes Google granted, and lists the account once with its apps", async () => {
    const { orgA } = await seedTwoOrgs();

    const google = await connectGoogle(orgA.member.ctx, orgA.member.email);

    expect(await getGrantedScopes(orgA.member.ctx, google.id)).toEqual(ALL_SCOPES);
    expect((await listConnections(orgA.member.ctx)).connections).toEqual([
      expect.objectContaining({
        id: google.id,
        source: "google",
        accountEmail: orgA.member.email,
        status: "backfilling",
        grantedScopes: ALL_SCOPES,
        apps: ["gmail", "drive", "sheets", "calendar", "docs", "tasks"],
        missingApps: [],
      }),
    ]);
  });

  it("lists the apps an account left unticked as missing", async () => {
    const { orgA } = await seedTwoOrgs();

    const google = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      scopes: allScopesBut("drive", "calendar"),
    });

    expect(await listed(orgA.member.ctx, google.id)).toMatchObject({
      apps: ["gmail", "sheets", "docs", "tasks"],
      missingApps: ["drive", "calendar"],
    });
    const admins = await listConnections(orgA.admin.ctx);
    expect(admins.memberConnections).toEqual([
      expect.objectContaining({ id: google.id, apps: ["gmail", "sheets", "docs", "tasks"] }),
    ]);
  });

  it("reads the account from Drive when Gmail wasn't allowed", async () => {
    const { orgA } = await seedTwoOrgs();

    const google = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      scopes: allScopesBut("gmail"),
    });

    expect(await listed(orgA.member.ctx, google.id)).toMatchObject({
      accountEmail: orgA.member.email,
      missingApps: ["gmail"],
    });
  });

  it("refuses an account that allowed neither Gmail nor Drive, and revokes it at Nango", async () => {
    const { orgA } = await seedTwoOrgs();

    const { connectionId } = await connectGmail(
      orgA.member.ctx,
      orgA.member.email,
      allScopesBut("gmail", "drive"),
    );

    const listing = await listConnections(orgA.member.ctx);
    expect(listing.connections).toEqual([]);
    expect(listing.attempts).toEqual([
      expect.objectContaining({
        source: "google",
        status: "refused",
        refusal: "Allow Gmail or Drive, so Mycel can tell which account this is.",
      }),
    ]);
    expect(fakeNango.hasConnection(connectionId)).toBe(false);
  });
});

describe("getGrantedScopes", () => {
  it("is for whoever may read the connection: its owner, or admins for an org one", async () => {
    const { orgA } = await seedTwoOrgs();
    const own = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      scopes: allScopesBut("tasks"),
    });
    const shared = await connectGoogle(orgA.admin.ctx, `support@${orgA.workspaceDomain}`, {
      kind: "org",
    });

    expect(await getGrantedScopes(orgA.member.ctx, own.id)).toEqual(allScopesBut("tasks"));
    expect(await getGrantedScopes(systemCtx(orgA.id), own.id)).toEqual(allScopesBut("tasks"));
    expect(await getGrantedScopes(orgA.admin.ctx, shared.id)).toEqual(ALL_SCOPES);
    await expect(getGrantedScopes(orgA.admin.ctx, own.id)).rejects.toThrow(ForbiddenError);
    await expect(getGrantedScopes(orgA.member.ctx, shared.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("reconnecting to allow a missing app", () => {
  it("works on a connection that doesn't need reauth, and records the new scopes", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = orgA.member.ctx;
    const google = await connectGoogle(ctx, orgA.member.email, {
      scopes: allScopesBut("calendar"),
    });

    const { token } = await startReconnect(ctx, google.id);
    expect(fakeNango.reconnectSessionsCreated()).toEqual([
      { token, connectionId: google.nangoConnectionId, integration: "google" },
    ]);
    await deliver(fakeNango.completeReconnect(token, undefined, ALL_SCOPES));

    expect(await getGrantedScopes(ctx, google.id)).toEqual(ALL_SCOPES);
    expect(await listed(ctx, google.id)).toMatchObject({ missingApps: [] });
    // Calendar isn't ingested, so nothing new backfills.
    expect(fakeInngest.sent("connections/apps.granted")).toEqual([]);
  });

  it("announces a newly allowed ingested app once, however often Nango redelivers", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = orgA.member.ctx;
    const google = await connectGoogle(ctx, orgA.member.email, { scopes: allScopesBut("drive") });
    const { token } = await startReconnect(ctx, google.id);
    const override = fakeNango.completeReconnect(token, undefined, ALL_SCOPES);

    await deliver(override);
    await deliver(override);

    expect(fakeInngest.sent("connections/apps.granted")).toHaveLength(1);
  });

  it("announces the app on Nango's redelivery when the first announcement failed", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = orgA.member.ctx;
    const google = await connectGoogle(ctx, orgA.member.email, { scopes: allScopesBut("drive") });
    const { token } = await startReconnect(ctx, google.id);
    const override = fakeNango.completeReconnect(token, undefined, ALL_SCOPES);

    fakeInngest.failSends();
    await expect(deliver(override)).rejects.toThrow();
    fakeInngest.failSends(false);
    await deliver(override);

    expect(fakeInngest.sent("connections/apps.granted")).toHaveLength(1);
    expect(await listed(ctx, google.id)).toMatchObject({ status: "backfilling" });
  });

  it("needs reauth when the reconnect reached a different Google account", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = orgA.member.ctx;
    const google = await connectGoogle(ctx, orgA.member.email, { scopes: allScopesBut("drive") });

    const { token } = await startReconnect(ctx, google.id);
    await deliver(
      fakeNango.completeReconnect(token, { emailAddress: "someone@else.example" }, ALL_SCOPES),
    );

    expect(await listed(ctx, google.id)).toMatchObject({
      status: "needs_reauth",
      missingApps: ["drive"],
    });
    expect(await getGrantedScopes(ctx, google.id)).toEqual(allScopesBut("drive"));
    expect(fakeInngest.sent("connections/apps.granted")).toEqual([]);
  });
});
