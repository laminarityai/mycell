// Drive events: scoped like any connection's (ADR-0001), and deleted with their Google
// connection on every deletion path, with its mail, leaving another connection's events about
// the same file alone.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, type TwoOrgs } from "@/db/testing/two-org-fixture";
import {
  disconnect,
  handleNangoWebhook,
  listConnections,
  reconcileConnections,
} from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import { connectDrive, connectGoogle, connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { backfillConnection, findEventsByObject } from "../server";

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

// A member's backfilled Google connection with one Drive file and a sent email linking it, and
// the org inbox's email linking the same file.
async function fileAndLinkingEmails() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  const ctx = orgA.member.ctx;
  const me = orgA.member.email;
  const inbox = `support@${orgA.workspaceDomain}`;
  const google = await connectGoogle(ctx, me, {
    files: [{ name: "Pricing", mimeType: SHEET, at: daysAgo(3), by: COLLEAGUE }],
  });
  const fileId = google.files[0].id;
  google.mailbox.add({
    from: me,
    to: ["buyer@customer.example"],
    sent: true,
    at: daysAgo(2),
    text: link(fileId),
  });
  const orgInbox = await connectMailbox(
    orgA.admin.ctx,
    inbox,
    [{ from: "buyer@customer.example", to: [inbox], at: daysAgo(1), text: link(fileId) }],
    "org",
  );
  await backfillConnection(ctx, google.id);
  await backfillConnection(orgA.admin.ctx, orgInbox.id);
  expect(await sources(ctx, fileId)).toEqual(["drive", "gmail"]);
  expect(await sources(orgA.admin.ctx, fileId)).toEqual(["gmail"]);
  return { ...orgs, ctx, google, fileId };
}

const link = (id: string) => `See https://drive.google.com/file/d/${id}/view`;

async function sources(ctx: Ctx, fileId: string) {
  return (await findEventsByObject(ctx, "drive_file", fileId)).map((event) => event.source);
}

// Nothing from the member's connection is left, from either app: no event by its file, its
// modifier or its owner. The org inbox's email about the same file stays.
async function expectForgotten({ orgA }: TwoOrgs, fileId: string) {
  const ctx = orgA.member.ctx;
  expect(await findEventsByObject(ctx, "drive_file", fileId)).toEqual([]);
  expect(await findEventsByObject(ctx, "email", COLLEAGUE)).toEqual([]);
  expect(await findEventsByObject(ctx, "email", orgA.member.email)).toEqual([]);
  expect((await listConnections(ctx)).connections).toEqual([]);
  expect(await sources(orgA.admin.ctx, fileId)).toEqual(["gmail"]);
}

describe("deleting a Google connection", () => {
  it("leaves nothing from Drive or Gmail when the user disconnects", async () => {
    const { ctx, google, fileId, ...orgs } = await fileAndLinkingEmails();

    await disconnect(ctx, google.id);

    await expectForgotten(orgs, fileId);
    expect(fakeNango.hasConnection(google.nangoConnectionId)).toBe(false);
  });

  it("leaves nothing for it after Nango's deletion webhook", async () => {
    const { google, fileId, ...orgs } = await fileAndLinkingEmails();

    const webhook = fakeNango.deleteOutsideMycel(google.nangoConnectionId);
    await handleNangoWebhook(webhook.rawBody, webhook.headers);

    await expectForgotten(orgs, fileId);
  });

  it("leaves nothing for it after the nightly reconciliation finds it gone", async () => {
    const { google, fileId, ...orgs } = await fileAndLinkingEmails();

    fakeNango.deleteWithoutWebhook(google.nangoConnectionId);
    await reconcileConnections();

    await expectForgotten(orgs, fileId);
  });
});
