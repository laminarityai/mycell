// One Google connection per account (ADR-0014): it runs every connector its granted apps allow,
// each with its own cursor, and every event keeps the connection's ID.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import {
  disconnect,
  getConnection,
  listConnections,
  startReconnect,
} from "@/features/connections/server";
import { GOOGLE_APP_SCOPES, type GoogleApp } from "@/features/connections/types";
import { systemCtx } from "@/lib/ctx";
import {
  connectGoogle,
  connectOldConnection,
  daysAgo,
  deliver,
  listed,
} from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { fakeNango } from "@/testing/fake-nango";
import { backfillConnection, findEventsByObject, pollConnection } from "../server";

beforeEach(resetDatabase);

const SHEET = "application/vnd.google-apps.spreadsheet";
const CUSTOMER = "alice@customer.example";

describe("a Google connection", () => {
  it("backfills mail and Drive files once, each app with its own cursor", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const google = await connectGoogle(orgA.member.ctx, me, {
      messages: [{ from: CUSTOMER, to: [me], text: "Hi", at: daysAgo(2) }],
      files: [{ name: "Pricing", mimeType: SHEET, at: daysAgo(3), by: CUSTOMER }],
    });

    expect(await backfillConnection(orgA.member.ctx, google.id)).toEqual({
      outcome: "done",
      items: 2,
    });

    const found = await findEventsByObject(orgA.member.ctx, "email", CUSTOMER);
    expect(found.map((event) => [event.source, event.connectionId])).toEqual([
      ["drive", google.id],
      ["gmail", google.id],
    ]);
    expect(await getConnection(orgA.member.ctx, google.id)).toMatchObject({
      ingest: {
        gmail: { status: "active", cursor: google.mailbox.profile().historyId },
        drive: { status: "active", cursor: google.drive.startPageToken().startPageToken },
      },
    });
    expect(await listed(orgA.member.ctx, google.id)).toMatchObject({
      source: "google",
      status: "active",
      backfilledItems: 2,
      apps: ["gmail", "drive", "sheets", "calendar", "docs", "tasks"],
      missingApps: [],
    });
  });

  it("polls mail and Drive from their own cursors", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const google = await connectGoogle(orgA.member.ctx, me);
    await backfillConnection(orgA.member.ctx, google.id);
    google.mailbox.add({ from: CUSTOMER, to: [me], text: "Later", at: new Date() });
    google.drive.add({ name: "Rota", mimeType: SHEET, at: new Date(), by: CUSTOMER });

    expect(await pollConnection(systemCtx(orgA.id), google.id)).toEqual({
      outcome: "polled",
      items: 2,
    });

    const found = await findEventsByObject(orgA.member.ctx, "email", CUSTOMER);
    expect(found.map((event) => event.source).sort()).toEqual(["drive", "gmail"]);
  });

  it("backfills an org account's mail and Drive as org-scoped events", async () => {
    const { orgA } = await seedTwoOrgs();
    const inbox = `support@${orgA.workspaceDomain}`;
    const google = await connectGoogle(orgA.admin.ctx, inbox, {
      kind: "org",
      messages: [{ from: CUSTOMER, to: [inbox], text: "Help", at: daysAgo(1) }],
      files: [{ name: "Rota", mimeType: SHEET, at: daysAgo(1), by: CUSTOMER }],
    });

    await backfillConnection(orgA.admin.ctx, google.id);

    const found = await findEventsByObject(orgA.admin.ctx, "email", CUSTOMER);
    expect(found.map((event) => [event.source, event.ownerScope]).sort()).toEqual([
      ["drive", "org"],
      ["gmail", "org"],
    ]);
    expect(await findEventsByObject(orgA.member.ctx, "email", CUSTOMER)).toEqual([]);
  });
});

describe("a Google connection not granted every app", () => {
  it("backfills and polls only the apps it was granted", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const google = await connectGoogle(orgA.member.ctx, me, {
      scopes: allScopesBut("drive"),
      messages: [{ from: CUSTOMER, to: [me], text: "Hi", at: daysAgo(2) }],
      files: [{ name: "Pricing", mimeType: SHEET, at: daysAgo(3), by: CUSTOMER }],
    });

    expect(await backfillConnection(orgA.member.ctx, google.id)).toEqual({
      outcome: "done",
      items: 1,
    });
    google.drive.add({ name: "Rota", mimeType: SHEET, at: new Date(), by: CUSTOMER });
    expect(await pollConnection(systemCtx(orgA.id), google.id)).toEqual({
      outcome: "polled",
      items: 0,
    });

    const found = await findEventsByObject(orgA.member.ctx, "email", CUSTOMER);
    expect(found.map((event) => event.source)).toEqual(["gmail"]);
    expect(await getConnection(orgA.member.ctx, google.id)).toMatchObject({
      apps: ["gmail", "sheets", "calendar", "docs", "tasks"],
      ingest: { gmail: { status: "active" } },
    });
    expect((await getConnection(orgA.member.ctx, google.id)).ingest.drive).toBeUndefined();
    expect(await listed(orgA.member.ctx, google.id)).toMatchObject({
      status: "active",
      missingApps: ["drive"],
    });
  });

  it("backfills Drive once a reconnect allows it, without storing mail twice", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const ctx = orgA.member.ctx;
    const google = await connectGoogle(ctx, me, {
      scopes: allScopesBut("drive"),
      messages: [{ from: CUSTOMER, to: [me], text: "Hi", at: daysAgo(2) }],
      files: [{ name: "Pricing", mimeType: SHEET, at: daysAgo(3), by: CUSTOMER }],
    });
    await backfillConnection(ctx, google.id);

    const { token } = await startReconnect(ctx, google.id);
    await deliver(fakeNango.completeReconnect(token, undefined, Object.values(GOOGLE_APP_SCOPES)));

    expect(fakeInngest.sent("connections/apps.granted")).toEqual([
      expect.objectContaining({
        data: { orgId: orgA.id, userId: "system", role: "system", connectionId: google.id },
      }),
    ]);
    expect(await listed(ctx, google.id)).toMatchObject({ status: "backfilling", missingApps: [] });
    expect(await backfillConnection(systemCtx(orgA.id), google.id)).toEqual({
      outcome: "done",
      items: 1,
    });
    const found = await findEventsByObject(ctx, "email", CUSTOMER);
    expect(found.map((event) => event.source)).toEqual(["drive", "gmail"]);
    expect(await listed(ctx, google.id)).toMatchObject({ status: "active" });
  });

  it("stops polling an app a reconnect leaves out, and keeps what it stored", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const ctx = orgA.member.ctx;
    const google = await connectGoogle(ctx, me, {
      files: [{ name: "Pricing", mimeType: SHEET, at: daysAgo(3), by: CUSTOMER }],
    });
    await backfillConnection(ctx, google.id);

    const { token } = await startReconnect(ctx, google.id);
    await deliver(fakeNango.completeReconnect(token, undefined, allScopesBut("drive")));
    google.drive.add({ name: "Rota", mimeType: SHEET, at: new Date(), by: CUSTOMER });

    expect(await pollConnection(systemCtx(orgA.id), google.id)).toEqual({
      outcome: "polled",
      items: 0,
    });
    expect(fakeInngest.sent("connections/apps.granted")).toEqual([]);
    expect(await findEventsByObject(ctx, "email", CUSTOMER)).toHaveLength(1);
    expect(await listed(ctx, google.id)).toMatchObject({ missingApps: ["drive"] });
  });
});

describe("replacing the one-app connections from before ADR-0014", () => {
  it("deletes the account's Gmail and Drive connections and their events, then backfills again", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const ctx = orgA.member.ctx;
    const message = { from: CUSTOMER, to: [me], text: "Hi", at: daysAgo(2) };
    const file = { name: "Pricing", mimeType: SHEET, at: daysAgo(3), by: CUSTOMER };
    const oldGmail = await connectOldConnection(ctx, "gmail", me, { messages: [message] });
    const oldDrive = await connectOldConnection(ctx, "drive", me, { files: [file] });
    await backfillConnection(ctx, oldGmail.id);
    await backfillConnection(ctx, oldDrive.id);
    expect(await findEventsByObject(ctx, "email", CUSTOMER)).toHaveLength(2);
    // Another member's old connection stays.
    const theirs = await connectOldConnection(orgA.admin.ctx, "gmail", orgA.admin.email);

    const google = await connectGoogle(ctx, me, { messages: [message], files: [file] });

    expect((await listConnections(ctx)).connections.map((c) => [c.id, c.source])).toEqual([
      [google.id, "google"],
    ]);
    expect(await findEventsByObject(ctx, "email", CUSTOMER)).toEqual([]);
    expect(fakeNango.hasConnection(oldGmail.nangoConnectionId)).toBe(false);
    expect(fakeNango.hasConnection(oldDrive.nangoConnectionId)).toBe(false);
    expect(await listed(orgA.admin.ctx, theirs.id)).toMatchObject({ source: "gmail" });

    await backfillConnection(ctx, google.id);
    const found = await findEventsByObject(ctx, "email", CUSTOMER);
    expect(found.map((event) => [event.source, event.connectionId])).toEqual([
      ["drive", google.id],
      ["gmail", google.id],
    ]);
  });

  it("replaces an org account's old connections with its org Google connection", async () => {
    const { orgA } = await seedTwoOrgs();
    const inbox = `support@${orgA.workspaceDomain}`;
    const old = await connectOldConnection(orgA.admin.ctx, "gmail", inbox, { kind: "org" });

    const google = await connectGoogle(orgA.admin.ctx, inbox, { kind: "org" });

    const { orgConnections } = await listConnections(orgA.admin.ctx);
    expect(orgConnections.map((c) => c.id)).toEqual([google.id]);
    expect(fakeNango.hasConnection(old.nangoConnectionId)).toBe(false);
  });

  it("keeps ingesting from an old connection until it's replaced", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const old = await connectOldConnection(orgA.member.ctx, "gmail", me);
    await backfillConnection(orgA.member.ctx, old.id);
    old.mailbox.add({ from: CUSTOMER, to: [me], text: "Later", at: new Date() });

    expect(await pollConnection(systemCtx(orgA.id), old.id)).toEqual({
      outcome: "polled",
      items: 1,
    });
    expect(await listed(orgA.member.ctx, old.id)).toMatchObject({
      apps: ["gmail"],
      missingApps: [],
    });
  });
});

describe("disconnecting a Google connection", () => {
  it("deletes everything from every app on it", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const ctx = orgA.member.ctx;
    const google = await connectGoogle(ctx, me, {
      messages: [{ from: CUSTOMER, to: [me], text: "Hi", at: daysAgo(2) }],
      files: [{ name: "Pricing", mimeType: SHEET, at: daysAgo(3), by: CUSTOMER }],
    });
    await backfillConnection(ctx, google.id);
    expect(await findEventsByObject(ctx, "email", CUSTOMER)).toHaveLength(2);

    await disconnect(ctx, google.id);

    expect(await findEventsByObject(ctx, "email", CUSTOMER)).toEqual([]);
    expect(await findEventsByObject(ctx, "drive_file", google.files[0]?.id ?? "")).toEqual([]);
    expect(await findEventsByObject(ctx, "email", me)).toEqual([]);
  });
});

function allScopesBut(app: GoogleApp): string[] {
  return Object.entries(GOOGLE_APP_SCOPES).flatMap(([name, scope]) =>
    name === app ? [] : [scope],
  );
}
