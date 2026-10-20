import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { backfillConnection, pollConnection } from "../server";

beforeEach(resetDatabase);

const RECEIVED = "discovery/gmail.message_received";
const CUSTOMER = "alice@customer.example";

// A member's mailbox with one message, backfilled, so it's active and has a cursor.
async function backfilledMailbox() {
  const { orgA } = await seedTwoOrgs();
  const me = orgA.member.email;
  const connection = await connectMailbox(orgA.member.ctx, me, [
    { from: CUSTOMER, to: [me], text: "Hello", at: daysAgo(2) },
  ]);
  await backfillConnection(orgA.member.ctx, connection.id);
  return { orgA, connection, me, poll: () => pollConnection(systemCtx(orgA.id), connection.id) };
}

describe("discovery/gmail.message_received", () => {
  it("is sent once for an inbound message a poll newly stores", async () => {
    const { orgA, connection, me, poll } = await backfilledMailbox();
    const at = new Date();
    const message = connection.mailbox.add({ from: CUSTOMER, to: [me], text: "Hi", at });

    await poll();
    await poll();

    expect(fakeInngest.sent(RECEIVED)).toEqual([
      {
        name: RECEIVED,
        id: `gmail-received-${connection.id}-${message.id}`,
        data: {
          orgId: orgA.id,
          connectionId: connection.id,
          sourceRef: message.id,
          occurredAt: at.toISOString(),
          labelIds: message.labelIds,
        },
        ts: expect.any(Number) as unknown,
      },
    ]);
  });

  it("isn't sent for what the backfill stores", async () => {
    await backfilledMailbox();

    expect(fakeInngest.sent(RECEIVED)).toEqual([]);
  });

  it("isn't sent for a sent message or a draft", async () => {
    const { connection, me, poll } = await backfilledMailbox();
    connection.mailbox.add({ from: me, to: [CUSTOMER], text: "Hi", at: new Date(), sent: true });
    // Gmail's history includes drafts as they're saved, labelled DRAFT: each draft a run makes
    // would otherwise start another run.
    connection.mailbox.add({ from: me, text: "Draft", at: new Date(), labelIds: ["DRAFT"] });

    await poll();

    expect(fakeInngest.sent(RECEIVED)).toEqual([]);
  });

  it("is sent for an inbound message a recovery newly stores, and not for what it re-reads", async () => {
    const { connection, me, poll } = await backfilledMailbox();
    const message = connection.mailbox.add({
      from: CUSTOMER,
      to: [me],
      text: "Hi",
      at: new Date(),
    });
    connection.mailbox.expireHistory();

    expect(await poll()).toMatchObject({ outcome: "recovered" });

    expect(fakeInngest.sent(RECEIVED).map((event) => event.data.sourceRef)).toEqual([message.id]);
  });
});
