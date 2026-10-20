// The Drive connector, end to end: backfilling files changed in the last 90 days, polling the
// changes feed, recovering an expired page token, and linking Drive changes to email.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { getConnection } from "@/features/connections/server";
import { systemCtx } from "@/lib/ctx";
import { fakeNango } from "@/testing/fake-nango";
import { backfillConnection, findEventsByObject, pollConnection } from "../server";
import { connectDrive, daysAgo, listed } from "@/testing/connect-helpers";

beforeEach(resetDatabase);

const SHEET = "application/vnd.google-apps.spreadsheet";
const COLLEAGUE = "colleague@customer.example";
const sheet = (name: string, at: Date, extra = {}) => ({ name, mimeType: SHEET, at, ...extra });

// A member's Drive with one spreadsheet, backfilled, so it's active and has a cursor.
async function backfilledDrive() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  const drive = await connectDrive(orgA.member.ctx, orgA.member.email, [
    sheet("Pricing", daysAgo(2)),
  ]);
  await backfillConnection(orgA.member.ctx, drive.id);
  const [file] = drive.files;
  return { ...orgs, drive, file, me: orgA.member.email, ctx: orgA.member.ctx };
}

describe("backfilling a Drive", () => {
  it("stores each recent file as an event, found by its file ID and the people on it", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const drive = await connectDrive(orgA.member.ctx, me);
    const pricing = drive.drive.add(
      sheet("Pricing", daysAgo(10), { by: COLLEAGUE, owners: [COLLEAGUE, me] }),
    );
    const contract = drive.drive.add({
      name: "Contract",
      mimeType: "application/pdf",
      at: daysAgo(5),
    });
    drive.drive.modify(contract.id, daysAgo(4), COLLEAGUE);
    const ancient = drive.drive.add(sheet("Ancient", daysAgo(91)));
    const shared = drive.drive.add(sheet("Team plan", daysAgo(3), { sharedDrive: true }));
    const trashed = drive.drive.add(sheet("Old draft", daysAgo(6)));
    drive.drive.trash(trashed.id, daysAgo(1));

    expect(await backfillConnection(orgA.member.ctx, drive.id)).toEqual({
      outcome: "done",
      items: 2,
    });

    const [created] = await findEventsByObject(orgA.member.ctx, "drive_file", pricing.id);
    expect(created).toEqual({
      id: expect.any(String) as string,
      connectionId: drive.id,
      ownerScope: "member",
      source: "drive",
      sourceRef: `${pricing.id}@${pricing.modifiedTime}`,
      type: "file.created",
      occurredAt: new Date(pricing.modifiedTime),
      actor: COLLEAGUE,
      counterparties: [me],
      direction: null,
      threadId: null,
      attachments: [],
      labelIds: [],
      mimeType: SHEET,
    });
    expect(await findEventsByObject(orgA.member.ctx, "drive_file", contract.id)).toEqual([
      expect.objectContaining({
        type: "file.modified",
        actor: COLLEAGUE,
        mimeType: "application/pdf",
      }),
    ]);
    // The modifying user and the owners are object refs.
    const colleague = await findEventsByObject(orgA.member.ctx, "email", COLLEAGUE.toUpperCase());
    expect(colleague.map((event) => event.sourceRef.split("@")[0]).sort()).toEqual(
      [pricing.id, contract.id].sort(),
    );
    // Outside the window, in a shared drive, or in the trash: not backfilled.
    for (const file of [ancient, shared, trashed]) {
      expect(await findEventsByObject(orgA.member.ctx, "drive_file", file.id)).toEqual([]);
    }
  });

  it("records the start page token first, pages through a large Drive, and shows progress", async () => {
    const { orgA } = await seedTwoOrgs();
    const files = Array.from({ length: 1001 }, (_, i) => sheet(`Sheet ${String(i)}`, daysAgo(1)));
    const drive = await connectDrive(orgA.member.ctx, orgA.member.email, files);
    const tokenBefore = drive.drive.startPageToken().startPageToken;

    await backfillConnection(orgA.member.ctx, drive.id);

    expect(await listed(orgA.member.ctx, drive.id)).toMatchObject({
      status: "active",
      backfilledItems: 1001,
    });
    expect(await getConnection(orgA.member.ctx, drive.id)).toMatchObject({
      ingest: { drive: { cursor: tokenBefore } },
    });
    const found = await findEventsByObject(orgA.member.ctx, "email", orgA.member.email);
    expect(found).toHaveLength(1001);
  });

  it("completes through Drive's 429s, which Nango's proxy retries", async () => {
    const { orgA } = await seedTwoOrgs();
    const drive = await connectDrive(orgA.member.ctx, orgA.member.email, [
      sheet("Pricing", daysAgo(1)),
    ]);
    fakeNango.rateLimitSource(3);

    expect(await backfillConnection(orgA.member.ctx, drive.id)).toEqual({
      outcome: "done",
      items: 1,
    });
    expect(fakeNango.rateLimitsAnswered()).toBe(3);
  });
});

describe("polling a Drive", () => {
  it("stores each new version once, and re-running the backfill or a poll adds nothing", async () => {
    const { orgA, drive, file, ctx } = await backfilledDrive();
    drive.drive.modify(file.id, new Date(), COLLEAGUE);
    const added = drive.drive.add(sheet("New sheet", new Date()));

    expect(await pollConnection(systemCtx(orgA.id), drive.id)).toEqual({
      outcome: "polled",
      items: 2,
    });
    const versions = await findEventsByObject(ctx, "drive_file", file.id);
    expect(versions.map((event) => [event.type, event.actor])).toEqual([
      ["file.created", orgA.member.email],
      ["file.modified", COLLEAGUE],
    ]);
    expect(await findEventsByObject(ctx, "drive_file", added.id)).toEqual([
      expect.objectContaining({ type: "file.created" }),
    ]);
    expect(await getConnection(ctx, drive.id)).toMatchObject({
      ingest: { drive: { cursor: drive.drive.startPageToken().startPageToken } },
    });

    expect(await pollConnection(systemCtx(orgA.id), drive.id)).toEqual({
      outcome: "polled",
      items: 0,
    });
    await backfillConnection(ctx, drive.id);
    expect(await findEventsByObject(ctx, "drive_file", file.id)).toEqual(versions);
  });

  it("leaves out files put in the trash", async () => {
    const { orgA, drive, file, ctx } = await backfilledDrive();
    drive.drive.trash(file.id, new Date());

    expect(await pollConnection(systemCtx(orgA.id), drive.id)).toEqual({
      outcome: "polled",
      items: 0,
    });
    expect(await findEventsByObject(ctx, "drive_file", file.id)).toHaveLength(1);
  });

  it("pages through a long changes feed", async () => {
    const { orgA, drive, ctx } = await backfilledDrive();
    for (let i = 0; i < 1001; i++) drive.drive.add(sheet(`Sheet ${String(i)}`, new Date()));

    expect(await pollConnection(systemCtx(orgA.id), drive.id)).toEqual({
      outcome: "polled",
      items: 1001,
    });
    expect(await findEventsByObject(ctx, "email", orgA.member.email)).toHaveLength(1002);
  });

  it("recovers from an expired page token by backfilling from the last event", async () => {
    const { orgA, drive, file, ctx } = await backfilledDrive();
    drive.drive.modify(file.id, new Date(), COLLEAGUE);
    drive.drive.expireTokens();

    expect(await pollConnection(systemCtx(orgA.id), drive.id)).toMatchObject({
      outcome: "recovered",
    });
    expect((await findEventsByObject(ctx, "drive_file", file.id)).map((e) => e.type)).toEqual([
      "file.created",
      "file.modified",
    ]);
    expect(await getConnection(ctx, drive.id)).toMatchObject({
      ingest: { drive: { status: "active", cursor: drive.drive.startPageToken().startPageToken } },
    });

    // Polling carries on from the fresh token.
    drive.drive.modify(file.id, new Date(Date.now() + 1000));
    expect(await pollConnection(systemCtx(orgA.id), drive.id)).toEqual({
      outcome: "polled",
      items: 1,
    });
    expect(await findEventsByObject(ctx, "drive_file", file.id)).toHaveLength(3);
  });
});

describe("Drive changes and email", () => {
  it("links an email that links a file and that file's Drive changes by its file ID", async () => {
    const { orgA, drive, file, me } = await backfilledDrive();
    // The same Google connection's mail, polled with its Drive.
    drive.mailbox.add({
      from: COLLEAGUE,
      to: [me],
      subject: "Pricing",
      text: `Updated https://docs.google.com/spreadsheets/d/${file.id}/edit#gid=0`,
      at: daysAgo(1),
    });
    drive.drive.modify(file.id, new Date(), COLLEAGUE);
    await pollConnection(systemCtx(orgA.id), drive.id);

    const found = await findEventsByObject(orgA.member.ctx, "drive_file", file.id);

    expect(found.map((event) => [event.source, event.type])).toEqual([
      ["drive", "file.created"],
      ["gmail", "email.received"],
      ["drive", "file.modified"],
    ]);
  });

  it("never returns a file's name or content", async () => {
    const { orgA, drive, file, ctx } = await backfilledDrive();
    drive.drive.add(sheet("SECRET-NAME.xlsx", new Date()));
    drive.drive.modify(file.id, new Date());
    await pollConnection(systemCtx(orgA.id), drive.id);

    const found = await findEventsByObject(ctx, "email", orgA.member.email);

    expect(found).toHaveLength(3);
    expect(JSON.stringify(found)).not.toMatch(/SECRET|Pricing/);
  });
});
