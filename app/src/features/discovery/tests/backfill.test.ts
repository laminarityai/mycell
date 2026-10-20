import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { getConnection } from "@/features/connections/server";
import { fakeInngest } from "@/testing/fake-inngest";
import { fakeNango } from "@/testing/fake-nango";
import { backfillConnection, findEventsByObject, markBackfillFailed } from "../server";
import { connectMailbox, daysAgo, listed } from "@/testing/connect-helpers";

beforeEach(resetDatabase);

const SHEET = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
const DOC = "1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_-abc";
const FILE = "0B7_dRiveFileId_42xyz";

describe("backfillConnection", () => {
  it("stores the last 90 days as events that later stages find by address and Drive file", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const connection = await connectMailbox(orgA.member.ctx, me, [
      {
        from: "Alice Buyer <Alice@Customer.example>",
        to: [me],
        cc: ["ops@customer.example"],
        subject: "Order 1182 pricing",
        text: `Prices are in https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=0`,
        attachments: [{ filename: "invoice-1182.pdf", mimeType: "application/pdf", size: 52_000 }],
        at: daysAgo(3),
        threadId: "thread-1182",
      },
      {
        from: me,
        to: ["alice@customer.example"],
        bcc: ["archive@org-a.test"],
        subject: "Re: Order 1182 pricing",
        text: "Updated, see the sheet. Ping bob@customer.example if it's wrong.",
        sent: true,
        at: daysAgo(2),
        threadId: "thread-1182",
      },
      { from: "alice@customer.example", to: [me], text: "Ancient history", at: daysAgo(91) },
    ]);

    expect(await backfillConnection(orgA.member.ctx, connection.id)).toEqual({
      outcome: "done",
      items: 2,
    });

    const aliceEvents = await findEventsByObject(
      orgA.member.ctx,
      "email",
      "ALICE@customer.example",
    );
    expect(aliceEvents).toEqual([
      {
        id: expect.any(String) as string,
        connectionId: connection.id,
        ownerScope: "member",
        source: "gmail",
        sourceRef: expect.any(String) as string,
        type: "email.received",
        occurredAt: expect.any(Date) as Date,
        actor: "alice@customer.example",
        counterparties: [me, "ops@customer.example"],
        direction: "inbound",
        threadId: "thread-1182",
        attachments: [{ mimeType: "application/pdf", size: 52_000, driveFileId: null }],
        labelIds: ["INBOX", "UNREAD", "CATEGORY_PERSONAL"],
        mimeType: null,
      },
      expect.objectContaining({
        type: "email.sent",
        direction: "outbound",
        actor: me,
        counterparties: ["alice@customer.example", "archive@org-a.test"],
        labelIds: ["SENT"],
      }),
    ]);
    // An address only the body mentions is an object ref too.
    expect(await findEventsByObject(orgA.member.ctx, "email", "bob@customer.example")).toEqual([
      aliceEvents[1],
    ]);
    expect(await findEventsByObject(orgA.member.ctx, "drive_file", SHEET)).toEqual([
      aliceEvents[0],
    ]);
    // Alice's 91-day-old message is outside the window, so only two events name her.
    expect(aliceEvents.every((event) => event.occurredAt >= daysAgo(90))).toBe(true);
  });

  it("finds Drive links in HTML-only bodies, Docs and Drive links included", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      {
        from: "drive-shares-noreply@google.com",
        to: [orgA.member.email],
        html: `<p>Shared <a href="https://docs.google.com/document/d/${DOC}/edit?usp=sharing">the plan</a>
          and <a href="https://drive.google.com/open?usp=x&amp;id=${FILE}">a file</a>.
          Questions: <a href="mailto:Carol@Partner.example">Carol</a></p>`,
        at: daysAgo(1),
      },
    ]);

    await backfillConnection(orgA.member.ctx, connection.id);

    const [byDoc] = await findEventsByObject(orgA.member.ctx, "drive_file", DOC);
    expect(byDoc).toBeDefined();
    expect(await findEventsByObject(orgA.member.ctx, "drive_file", FILE)).toEqual([byDoc]);
    expect(await findEventsByObject(orgA.member.ctx, "email", "carol@partner.example")).toEqual([
      byDoc,
    ]);
  });

  it("never returns a subject, body, snippet or file name", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      {
        from: "alice@customer.example",
        to: [orgA.member.email],
        subject: "SECRET-SUBJECT",
        text: "SECRET-BODY lives here",
        html: "<b>SECRET-HTML</b>",
        attachments: [{ filename: "SECRET-FILENAME.xlsx", mimeType: "text/csv", size: 10 }],
        at: daysAgo(5),
      },
    ]);

    await backfillConnection(orgA.member.ctx, connection.id);

    const found = await findEventsByObject(orgA.member.ctx, "email", "alice@customer.example");
    expect(found).toHaveLength(1);
    expect(JSON.stringify(found)).not.toMatch(/SECRET/);
  });

  it("pages through a large mailbox, recording the history ID first and the progress", async () => {
    const { orgA } = await seedTwoOrgs();
    const messages = Array.from({ length: 230 }, (_, i) => ({
      from: "alice@customer.example",
      to: [orgA.member.email],
      text: `Message ${String(i)}`,
      at: daysAgo(1 + (i % 80)),
    }));
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email, messages);
    const historyIdBefore = connection.mailbox.profile().historyId;
    expect(await listed(orgA.member.ctx, connection.id)).toMatchObject({
      status: "backfilling",
      backfilledItems: 0,
    });

    await backfillConnection(orgA.member.ctx, connection.id);

    expect(await listed(orgA.member.ctx, connection.id)).toMatchObject({
      status: "active",
      backfilledItems: 230,
    });
    expect(await getConnection(orgA.member.ctx, connection.id)).toMatchObject({
      ingest: { gmail: { cursor: historyIdBefore } },
    });
    const found = await findEventsByObject(orgA.member.ctx, "email", "alice@customer.example");
    expect(new Set(found.map((event) => event.sourceRef)).size).toBe(230);
  });

  it("adds nothing when it runs again", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      { from: "alice@customer.example", to: [orgA.member.email], text: "One", at: daysAgo(4) },
      { from: "alice@customer.example", to: [orgA.member.email], text: "Two", at: daysAgo(3) },
    ]);
    await backfillConnection(orgA.member.ctx, connection.id);
    const first = await findEventsByObject(orgA.member.ctx, "email", "alice@customer.example");

    await backfillConnection(orgA.member.ctx, connection.id);

    expect(await findEventsByObject(orgA.member.ctx, "email", "alice@customer.example")).toEqual(
      first,
    );
    expect(first).toHaveLength(2);
  });

  it("completes through the source's 429s, which Nango's proxy retries", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      { from: "alice@customer.example", to: [orgA.member.email], text: "Hi", at: daysAgo(1) },
    ]);
    fakeNango.rateLimitSource(3);

    expect(await backfillConnection(orgA.member.ctx, connection.id)).toEqual({
      outcome: "done",
      items: 1,
    });
    expect(fakeNango.rateLimitsAnswered()).toBe(3);
  });

  it("fails the step when Nango runs out of retries, and a rerun completes", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      { from: "alice@customer.example", to: [orgA.member.email], text: "Hi", at: daysAgo(1) },
    ]);
    fakeNango.rateLimitSource(4);

    await expect(backfillConnection(orgA.member.ctx, connection.id)).rejects.toThrow(/429/);
    expect(await backfillConnection(orgA.member.ctx, connection.id)).toMatchObject({ items: 1 });
  });
});

describe("starting a backfill", () => {
  it("sends the event that starts the backfill job when a connection is recorded", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email);

    expect(fakeInngest.sent()).toEqual([
      expect.objectContaining({
        name: "connections/connection.recorded",
        id: `connection-recorded-${connection.id}`,
        data: {
          orgId: orgA.id,
          userId: orgA.member.id,
          role: "member",
          connectionId: connection.id,
        },
      }),
    ]);
  });
});

describe("markBackfillFailed", () => {
  it("shows the connection's backfill failed", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email);

    await markBackfillFailed(orgA.member.ctx, connection.id);

    expect(await listed(orgA.member.ctx, connection.id)).toMatchObject({ status: "failed" });
  });
});
