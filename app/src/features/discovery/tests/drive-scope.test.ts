// A Drive connection's events: scoped like any connection's (ADR-0001), and deleted with it on
// every deletion path, leaving another connection's events about the same file alone.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import {
  disconnect,
  handleNangoWebhook,
  listConnections,
  reconcileConnections,
} from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import { fakeNango } from "@/testing/fake-nango";
import { backfillConnection, findEventsByObject } from "../server";
import { connectDrive, connectMailbox, daysAgo } from "./ingest-helpers";

beforeEach(resetDatabase);

const SHEET = "application/vnd.google-apps.spreadsheet";
const COLLEAGUE = "colleague@customer.example";

describe("Drive owner scopes", () => {
  it("scopes an org Drive's events to admins, and a member Drive's to its owner", async () => {
    const { orgA } = await seedTwoOrgs();
    const shared = `shared@${orgA.workspaceDomain}`;
    const orgDrive = await connectDrive(
      orgA.admin.ctx,
      shared,
      [{ name: "Rota", mimeType: SHEET, at: daysAgo(1), by: COLLEAGUE }],
      "org",
    );
    const memberDrive = await connectDrive(orgA.member.ctx, orgA.member.email, [
      { name: "Notes", mimeType: SHEET, at: daysAgo(1), by: COLLEAGUE },
    ]);
    await backfillConnection(orgA.admin.ctx, orgDrive.id);
    await backfillConnection(orgA.member.ctx, memberDrive.id);

    const admins = await findEventsByObject(orgA.admin.ctx, "email", COLLEAGUE);
    expect(admins.map((e) => [e.connectionId, e.ownerScope])).toEqual([[orgDrive.id, "org"]]);
    const members = await findEventsByObject(orgA.member.ctx, "email", COLLEAGUE);
    expect(members.map((e) => [e.connectionId, e.ownerScope])).toEqual([
      [memberDrive.id, "member"],
    ]);
  });
});

// A member's backfilled Drive with one file, and their Gmail with an email linking that file.
async function driveAndLinkingEmail() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  const ctx = orgA.member.ctx;
  const me = orgA.member.email;
  const drive = await connectDrive(ctx, me, [
    { name: "Pricing", mimeType: SHEET, at: daysAgo(3), by: COLLEAGUE },
  ]);
  const fileId = drive.files[0].id;
  const mailbox = await connectMailbox(ctx, me, [
    { from: me, to: ["buyer@customer.example"], sent: true, at: daysAgo(2), text: link(fileId) },
  ]);
  await backfillConnection(ctx, drive.id);
  await backfillConnection(ctx, mailbox.id);
  expect(await sources(ctx, fileId)).toEqual(["drive", "gmail"]);
  return { ...orgs, ctx, drive, mailbox, fileId };
}

const link = (id: string) => `See https://drive.google.com/file/d/${id}/view`;

async function sources(ctx: Ctx, fileId: string) {
  return (await findEventsByObject(ctx, "drive_file", fileId)).map((event) => event.source);
}

// Nothing from the Drive connection is left: no event by its file, its modifier or its owner.
async function expectDriveForgotten(ctx: Ctx, connectionId: string, fileId: string, me: string) {
  const left = [
    ...(await findEventsByObject(ctx, "drive_file", fileId)),
    ...(await findEventsByObject(ctx, "email", COLLEAGUE)),
    ...(await findEventsByObject(ctx, "email", me)),
  ];
  expect(left.filter((event) => event.connectionId === connectionId)).toEqual([]);
  expect(await sources(ctx, fileId)).toEqual(["gmail"]);
  const listing = await listConnections(ctx);
  expect(listing.connections.map((c) => c.source)).toEqual(["gmail"]);
}

describe("deleting a Drive connection", () => {
  it("leaves nothing for it when the user disconnects", async () => {
    const { orgA, ctx, drive, fileId } = await driveAndLinkingEmail();

    await disconnect(ctx, drive.id);

    await expectDriveForgotten(ctx, drive.id, fileId, orgA.member.email);
    expect(fakeNango.hasConnection(drive.nangoConnectionId)).toBe(false);
  });

  it("leaves nothing for it after Nango's deletion webhook", async () => {
    const { orgA, ctx, drive, fileId } = await driveAndLinkingEmail();

    const webhook = fakeNango.deleteOutsideMycel(drive.nangoConnectionId);
    await handleNangoWebhook(webhook.rawBody, webhook.headers);

    await expectDriveForgotten(ctx, drive.id, fileId, orgA.member.email);
  });

  it("leaves nothing for it after the nightly reconciliation finds it gone", async () => {
    const { orgA, ctx, drive, fileId } = await driveAndLinkingEmail();

    fakeNango.deleteWithoutWebhook(drive.nangoConnectionId);
    await reconcileConnections();

    await expectDriveForgotten(ctx, drive.id, fileId, orgA.member.email);
  });
});
