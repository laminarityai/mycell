import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { disconnect, getConnection } from "@/features/connections/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { fakeNango } from "@/testing/fake-nango";
import {
  backfillConnection,
  findEventsByObject,
  pollAllConnections,
  pollConnection,
} from "../server";
import { connectMailbox, daysAgo, listed } from "@/testing/connect-helpers";

beforeEach(resetDatabase);

const CUSTOMER = "alice@customer.example";
const LATE = "late@customer.example";

const fromCustomer = (to: string, at = daysAgo(1), from = CUSTOMER) => ({
  from,
  to: [to],
  text: "Hello",
  at,
});

// A member's mailbox with one message, backfilled, so it's active and has a cursor.
async function backfilledMailbox() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  const connection = await connectMailbox(orgA.member.ctx, orgA.member.email, [
    fromCustomer(orgA.member.email, daysAgo(2)),
  ]);
  await backfillConnection(orgA.member.ctx, connection.id);
  return { ...orgs, connection, me: orgA.member.email, ctx: orgA.member.ctx };
}

describe("pollConnection", () => {
  it("stores a message that arrived after the backfill, and a second poll adds nothing", async () => {
    const { orgA, connection, me, ctx } = await backfilledMailbox();
    connection.mailbox.add(fromCustomer(me, new Date(), LATE));

    expect(await pollConnection(systemCtx(orgA.id), connection.id)).toEqual({
      outcome: "polled",
      items: 1,
    });
    const found = await findEventsByObject(ctx, "email", LATE);
    expect(found).toEqual([expect.objectContaining({ actor: LATE, connectionId: connection.id })]);
    expect(await getConnection(ctx, connection.id)).toMatchObject({
      ingest: { gmail: { cursor: connection.mailbox.profile().historyId } },
    });
    expect((await listed(ctx, connection.id))?.lastPolledAt).toBeInstanceOf(Date);

    expect(await pollConnection(systemCtx(orgA.id), connection.id)).toEqual({
      outcome: "polled",
      items: 0,
    });
    expect(await findEventsByObject(ctx, "email", LATE)).toEqual(found);
    expect(await findEventsByObject(ctx, "email", CUSTOMER)).toHaveLength(1);
  });

  it("stores a message that arrived during the backfill exactly once", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const connection = await connectMailbox(orgA.member.ctx, me, [fromCustomer(me, daysAgo(3))]);
    // One arrives after the history ID was read but before the listing, so the backfill and
    // the poll both see it; another while messages are being fetched, so only the poll does.
    let listings = 0;
    let gets = 0;
    fakeNango.beforeProxy((path) => {
      if (path === "/gmail/v1/users/me/messages" && ++listings === 1) {
        connection.mailbox.add(fromCustomer(me, new Date(), LATE));
      }
      if (/\/messages\/[^/]+$/.test(path) && ++gets === 1) {
        connection.mailbox.add(fromCustomer(me, new Date(), "later@customer.example"));
      }
    });

    await backfillConnection(orgA.member.ctx, connection.id);
    expect(await findEventsByObject(orgA.member.ctx, "email", LATE)).toHaveLength(1);
    await pollConnection(systemCtx(orgA.id), connection.id);

    expect(await findEventsByObject(orgA.member.ctx, "email", LATE)).toHaveLength(1);
    const later = await findEventsByObject(orgA.member.ctx, "email", "later@customer.example");
    expect(later).toHaveLength(1);
    expect(await findEventsByObject(orgA.member.ctx, "email", CUSTOMER)).toHaveLength(1);
  });

  it("pages through a long history", async () => {
    const { orgA, connection, me, ctx } = await backfilledMailbox();
    for (let i = 0; i < 501; i++) connection.mailbox.add(fromCustomer(me, new Date(), LATE));

    expect(await pollConnection(systemCtx(orgA.id), connection.id)).toEqual({
      outcome: "polled",
      items: 501,
    });
    const found = await findEventsByObject(ctx, "email", LATE);
    expect(new Set(found.map((event) => event.sourceRef)).size).toBe(501);
  });

  it("leaves out spam and trash, as the backfill's listing does", async () => {
    const { orgA, connection, me, ctx } = await backfilledMailbox();
    connection.mailbox.add({ ...fromCustomer(me, new Date(), LATE), labelIds: ["SPAM"] });
    connection.mailbox.add({ ...fromCustomer(me, new Date(), LATE), labelIds: ["TRASH"] });

    await pollConnection(systemCtx(orgA.id), connection.id);

    expect(await findEventsByObject(ctx, "email", LATE)).toEqual([]);
  });

  it("recovers from an expired history ID by backfilling from the last event, without duplicates", async () => {
    const { orgA, connection, me, ctx } = await backfilledMailbox();
    connection.mailbox.add(fromCustomer(me, new Date(), LATE));
    connection.mailbox.add(fromCustomer(me, new Date(), LATE));
    connection.mailbox.expireHistory();

    expect(await pollConnection(systemCtx(orgA.id), connection.id)).toMatchObject({
      outcome: "recovered",
    });

    // The overlap re-read the backfilled message, which is still stored once.
    expect(await findEventsByObject(ctx, "email", CUSTOMER)).toHaveLength(1);
    expect(await findEventsByObject(ctx, "email", LATE)).toHaveLength(2);
    expect(await getConnection(ctx, connection.id)).toMatchObject({
      ingest: { gmail: { status: "active", cursor: connection.mailbox.profile().historyId } },
    });
    expect(await listed(ctx, connection.id)).toMatchObject({ status: "active" });

    // Polling carries on from the reset cursor.
    connection.mailbox.add(fromCustomer(me, new Date(), "next@customer.example"));
    expect(await pollConnection(systemCtx(orgA.id), connection.id)).toEqual({
      outcome: "polled",
      items: 1,
    });
    expect(await findEventsByObject(ctx, "email", LATE)).toHaveLength(2);
  });

  it("skips a connection that is still backfilling", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const connection = await connectMailbox(orgA.member.ctx, me, [fromCustomer(me)]);

    expect(await pollConnection(systemCtx(orgA.id), connection.id)).toEqual({
      outcome: "skipped",
    });
    expect(await findEventsByObject(orgA.member.ctx, "email", CUSTOMER)).toEqual([]);
  });

  it("ends quietly for a connection that's gone", async () => {
    const { orgA, connection, ctx } = await backfilledMailbox();
    await disconnect(ctx, connection.id);

    expect(await pollConnection(systemCtx(orgA.id), connection.id)).toEqual({ outcome: "gone" });
  });

  it("lets a user poll only a connection they may read", async () => {
    const { orgA, connection } = await backfilledMailbox();

    expect(await pollConnection(orgA.member.ctx, connection.id)).toMatchObject({
      outcome: "polled",
    });
    await expect(pollConnection(orgA.admin.ctx, connection.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("pollAllConnections", () => {
  it("lists every active connection in every org, with the org its poll acts in", async () => {
    const { orgA, orgB, connection } = await backfilledMailbox();
    const inbox = `support@${orgB.workspaceDomain}`;
    const orgBInbox = await connectMailbox(orgB.admin.ctx, inbox, [], "org");
    await backfillConnection(orgB.admin.ctx, orgBInbox.id);
    // Still backfilling, so not polled yet.
    await connectMailbox(orgA.admin.ctx, orgA.admin.email);

    const due = await pollAllConnections();

    expect(due).toHaveLength(2);
    expect(due).toEqual(
      expect.arrayContaining([
        { orgId: orgA.id, connectionId: connection.id },
        { orgId: orgB.id, connectionId: orgBInbox.id },
      ]),
    );
  });
});
