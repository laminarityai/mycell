import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { disconnect, handleNangoWebhook, listConnections } from "@/features/connections/server";
import { fakeNango } from "@/testing/fake-nango";
import { backfillConnection, findEventsByObject, markBackfillFailed } from "../server";
import { connectMailbox, daysAgo } from "./ingest-helpers";

beforeEach(resetDatabase);

const CUSTOMER = "alice@customer.example";

// Enough messages for three pages, so a deletion can land in the middle.
function manyMessages(to: string) {
  return Array.from({ length: 250 }, (_, i) => ({
    from: CUSTOMER,
    to: [to],
    text: `Message ${String(i)}`,
    at: daysAgo(1 + (i % 60)),
  }));
}

// Runs `act` once, just before the `n`th messages.get the backfill makes. The backfill can end
// before `act` does (other fetches in flight see the connection gone), so the returned function
// waits for it.
function beforeNthMessageGet(n: number, act: () => Promise<void>): () => Promise<void> {
  let gets = 0;
  let acted: Promise<void> | undefined;
  fakeNango.beforeProxy(async (path) => {
    if (!/\/messages\/[^/]+$/.test(path)) return;
    gets += 1;
    if (gets === n) {
      acted = act();
      await acted;
    }
  });
  return async () => {
    if (acted === undefined) throw new Error(`The backfill made fewer than ${String(n)} gets`);
    await acted;
  };
}

describe("a connection deleted mid-backfill", () => {
  it("ends the backfill quietly when the user disconnects", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = orgA.member.ctx;
    const connection = await connectMailbox(
      ctx,
      orgA.member.email,
      manyMessages(orgA.member.email),
    );
    const disconnected = beforeNthMessageGet(150, () => disconnect(ctx, connection.id));

    expect(await backfillConnection(ctx, connection.id)).toEqual({ outcome: "gone" });
    await disconnected();

    expect((await listConnections(ctx)).connections).toEqual([]);
    expect(await findEventsByObject(ctx, "email", CUSTOMER)).toEqual([]);
  });

  it("ends quietly when Nango's deletion webhook arrives while the source still answers", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = orgA.member.ctx;
    const connection = await connectMailbox(
      ctx,
      orgA.member.email,
      manyMessages(orgA.member.email),
    );
    // Mycel forgets the connection during the second page's last fetch, after every fetch of
    // that page found the connection, and Nango still answers: the page's write is the first
    // thing to find the connection gone, through its foreign key.
    const forgotten = beforeNthMessageGet(200, async () => {
      const webhook = fakeNango.authWebhook(connection.nangoConnectionId, "deletion", true);
      await handleNangoWebhook(webhook.rawBody, webhook.headers);
    });

    expect(await backfillConnection(ctx, connection.id)).toEqual({ outcome: "gone" });
    await forgotten();

    expect((await listConnections(ctx)).connections).toEqual([]);
    expect(await findEventsByObject(ctx, "email", CUSTOMER)).toEqual([]);
  });

  it("treats a backfill or failure for a connection already gone as done, not an error", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = orgA.member.ctx;
    const connection = await connectMailbox(ctx, orgA.member.email);
    await disconnect(ctx, connection.id);

    expect(await backfillConnection(ctx, connection.id)).toEqual({ outcome: "gone" });
    await expect(markBackfillFailed(ctx, connection.id)).resolves.toBeUndefined();
  });
});

describe("disconnecting after a backfill", () => {
  it("leaves no events or object refs, even once the same mailbox is connected again", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = orgA.member.ctx;
    const messages = [{ from: CUSTOMER, to: [orgA.member.email], text: "Hi", at: daysAgo(2) }];
    const first = await connectMailbox(ctx, orgA.member.email, messages);
    await backfillConnection(ctx, first.id);
    expect(await findEventsByObject(ctx, "email", CUSTOMER)).toHaveLength(1);

    await disconnect(ctx, first.id);
    expect(await findEventsByObject(ctx, "email", CUSTOMER)).toEqual([]);

    // Reconnected but not yet backfilled: nothing from the first connection comes back.
    await connectMailbox(ctx, orgA.member.email, messages);
    expect(await findEventsByObject(ctx, "email", CUSTOMER)).toEqual([]);
  });

  it("leaves no org-connection events after Nango deletes the connection", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = orgA.admin.ctx;
    const inbox = `support@${orgA.workspaceDomain}`;
    const connection = await connectMailbox(
      ctx,
      inbox,
      [{ from: CUSTOMER, to: [inbox], text: "Help", at: daysAgo(2) }],
      "org",
    );
    await backfillConnection(ctx, connection.id);
    expect(await findEventsByObject(ctx, "email", CUSTOMER)).toHaveLength(1);

    const webhook = fakeNango.deleteOutsideMycel(connection.nangoConnectionId);
    await handleNangoWebhook(webhook.rawBody, webhook.headers);

    expect(await findEventsByObject(ctx, "email", CUSTOMER)).toEqual([]);
  });
});
