import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle, connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { ForbiddenError } from "@/lib/errors";
import { backfillConnection, countStoredItems, listStoredItems, pollConnection } from "../server";

beforeEach(resetDatabase);

const STORED = "discovery/item.stored";
const CUSTOMER = "alice@customer.example";

describe("discovery/item.stored", () => {
  it("is sent for each Gmail message a backfill stores, received or sent, but not a draft", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const connection = await connectMailbox(orgA.member.ctx, me, []);
    const received = connection.mailbox.add({ from: CUSTOMER, to: [me], at: daysAgo(3) });
    const sent = connection.mailbox.add({ from: me, to: [CUSTOMER], at: daysAgo(2), sent: true });
    connection.mailbox.add({ from: me, at: daysAgo(1), labelIds: ["DRAFT"] });

    await backfillConnection(orgA.member.ctx, connection.id);

    const stored = fakeInngest.sent(STORED);
    expect(stored.map((event) => event.data).sort(bySourceRef)).toEqual(
      [received, sent]
        .map((message) => ({
          orgId: orgA.id,
          connectionId: connection.id,
          app: "gmail",
          sourceRef: message.id,
          occurredAt: new Date(Number(message.internalDate)).toISOString(),
        }))
        .sort(bySourceRef),
    );
    expect(stored.map((event) => event.id)).toContain(
      `item-stored-${connection.id}-gmail-${received.id}`,
    );
  });

  it("is sent once for a message a poll newly stores", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const connection = await connectMailbox(orgA.member.ctx, me, []);
    await backfillConnection(orgA.member.ctx, connection.id);
    const message = connection.mailbox.add({ from: CUSTOMER, to: [me], at: new Date() });

    await pollConnection(systemCtx(orgA.id), connection.id);
    await pollConnection(systemCtx(orgA.id), connection.id);

    expect(fakeInngest.sent(STORED).map((event) => event.data.sourceRef)).toEqual([message.id]);
  });

  it("isn't sent for Drive files", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      files: [{ name: "Plan", mimeType: "application/vnd.google-apps.document", at: daysAgo(1) }],
    });

    await backfillConnection(orgA.member.ctx, connection.id);

    expect(fakeInngest.sent(STORED)).toEqual([]);
  });
});

describe("the stored items, listed again", () => {
  it("are the items discovery announced, in pages, and counted", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const connection = await connectMailbox(orgA.member.ctx, me, []);
    for (const day of [3, 2, 1])
      connection.mailbox.add({ from: CUSTOMER, to: [me], at: daysAgo(day) });
    connection.mailbox.add({ from: me, at: daysAgo(1), labelIds: ["DRAFT"] });
    await backfillConnection(orgA.member.ctx, connection.id);
    const ctx = systemCtx(orgA.id);

    const first = await listStoredItems(ctx, { limit: 2 });
    const second = await listStoredItems(ctx, { after: first.next ?? "", limit: 2 });

    expect(second.next).toBeNull();
    const announced = fakeInngest.sent(STORED).map(({ data }) => ({
      ...data,
      occurredAt: new Date(String(data.occurredAt)),
    }));
    expect(
      [...first.items, ...second.items]
        .map((item) => ({ orgId: orgA.id, ...item }))
        .sort(bySourceRef),
    ).toEqual(announced.sort(bySourceRef));
    expect(await countStoredItems(orgA.admin.ctx)).toBe(3);
  });

  it("are out of a member's reach", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(listStoredItems(orgA.member.ctx, { limit: 10 })).rejects.toThrow(ForbiddenError);
    await expect(countStoredItems(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
  });
});

function bySourceRef(a: Record<string, unknown>, b: Record<string, unknown>): number {
  return String(a.sourceRef).localeCompare(String(b.sourceRef));
}
