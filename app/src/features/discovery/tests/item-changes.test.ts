import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle, connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { backfillConnection, pollConnection } from "../server";

beforeEach(resetDatabase);

const REMOVED = "discovery/item.removed";
const CHANGED = "discovery/item.changed";
const CUSTOMER = "alice@customer.example";
const DOC = "application/vnd.google-apps.document";

const dataOf = (name: string) => fakeInngest.sent(name).map((event) => event.data);

describe("discovery/item.removed", () => {
  it("is sent for each Gmail message a poll finds deleted or moved to the trash", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const connection = await connectMailbox(orgA.member.ctx, me, [
      { from: CUSTOMER, to: [me], at: daysAgo(3) },
      { from: CUSTOMER, to: [me], at: daysAgo(2) },
      { from: CUSTOMER, to: [me], at: daysAgo(1) },
    ]);
    await backfillConnection(orgA.member.ctx, connection.id);
    const [deleted, trashed] = [...(connection.mailbox.list(new URLSearchParams()).messages ?? [])];

    connection.mailbox.delete(deleted.id);
    connection.mailbox.trash(trashed.id);
    await pollConnection(systemCtx(orgA.id), connection.id);
    await pollConnection(systemCtx(orgA.id), connection.id);

    expect(dataOf(REMOVED)).toEqual([
      { orgId: orgA.id, connectionId: connection.id, app: "gmail", itemId: deleted.id },
      { orgId: orgA.id, connectionId: connection.id, app: "gmail", itemId: trashed.id },
    ]);
  });

  it("is sent for each Drive file a poll finds deleted, trashed or no longer shared with the account", async () => {
    const { orgA } = await seedTwoOrgs();
    const file = { name: "Notes", mimeType: DOC, at: daysAgo(2) };
    const connection = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      files: [file, file, file],
    });
    await backfillConnection(orgA.member.ctx, connection.id);
    const [removed, trashed, kept] = connection.files;

    connection.drive.remove(removed.id);
    connection.drive.trash(trashed.id, new Date());
    await pollConnection(systemCtx(orgA.id), connection.id);
    await pollConnection(systemCtx(orgA.id), connection.id);

    expect(dataOf(REMOVED)).toEqual([
      { orgId: orgA.id, connectionId: connection.id, app: "drive", itemId: removed.id },
      { orgId: orgA.id, connectionId: connection.id, app: "drive", itemId: trashed.id },
    ]);
    expect(dataOf(REMOVED).map((data) => data.itemId)).not.toContain(kept.id);
  });

  it("isn't sent by a backfill, which only lists what's there", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      files: [{ name: "Notes", mimeType: DOC, at: daysAgo(2) }],
    });
    connection.drive.remove(connection.files[0].id);

    await backfillConnection(orgA.member.ctx, connection.id);

    expect(dataOf(REMOVED)).toEqual([]);
  });
});

describe("discovery/item.changed", () => {
  it("is sent for a Drive file whose sharing changed with no new version, once a poll", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      files: [{ name: "Notes", mimeType: DOC, at: daysAgo(2) }],
    });
    await backfillConnection(orgA.member.ctx, connection.id);
    const [notes] = connection.files;
    const version = `${notes.id}@${notes.modifiedTime}`;

    connection.drive.share(notes.id, { type: "user", emailAddress: CUSTOMER });
    await pollConnection(systemCtx(orgA.id), connection.id);
    await pollConnection(systemCtx(orgA.id), connection.id);
    connection.drive.unshare(notes.id, CUSTOMER);
    await pollConnection(systemCtx(orgA.id), connection.id);

    const changed = {
      orgId: orgA.id,
      connectionId: connection.id,
      app: "drive",
      sourceRef: version,
    };
    expect(dataOf(CHANGED)).toEqual([changed, changed]);
    // Two changes to one file are two events, not one Inngest drops as a duplicate.
    const ids = fakeInngest.sent(CHANGED).map((event) => event.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("isn't sent for a file's new version, which is stored and learned on its own", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      files: [{ name: "Notes", mimeType: DOC, at: daysAgo(2) }],
    });
    await backfillConnection(orgA.member.ctx, connection.id);

    connection.drive.modify(connection.files[0].id, new Date());
    await pollConnection(systemCtx(orgA.id), connection.id);

    expect(dataOf(CHANGED)).toEqual([]);
  });
});
