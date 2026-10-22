import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle, connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { backfillConnection, pollConnection } from "../server";

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

  it("is sent for each Drive file version a backfill or a poll newly stores", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      files: [{ name: "Plan", mimeType: "application/vnd.google-apps.document", at: daysAgo(2) }],
    });
    const [plan] = connection.files;
    const first = plan.modifiedTime;

    await backfillConnection(orgA.member.ctx, connection.id);
    const edited = new Date();
    connection.drive.modify(plan.id, edited);
    await pollConnection(systemCtx(orgA.id), connection.id);
    await pollConnection(systemCtx(orgA.id), connection.id);

    expect(fakeInngest.sent(STORED).map((event) => event.data)).toEqual([
      {
        orgId: orgA.id,
        connectionId: connection.id,
        app: "drive",
        sourceRef: `${plan.id}@${first}`,
        occurredAt: first,
      },
      {
        orgId: orgA.id,
        connectionId: connection.id,
        app: "drive",
        sourceRef: `${plan.id}@${edited.toISOString()}`,
        occurredAt: edited.toISOString(),
      },
    ]);
  });
});

function bySourceRef(a: Record<string, unknown>, b: Record<string, unknown>): number {
  return String(a.sourceRef).localeCompare(String(b.sourceRef));
}
