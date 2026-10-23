// The sweep (ADR-0026): the minute cron polls a connection only when one of its active apps is
// due. An app with no live watch is due every minute; one with a live watch once its last poll
// is 15 minutes old. Times run on a fake clock, so the edges are exact.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { getConnection, recordIngestState } from "@/features/connections/server";
import { GOOGLE_APP_SCOPES } from "@/features/connections/types";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle, connectMailbox, deliver } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { backfillConnection, pollAllConnections, pollConnection } from "../server";

const MINUTE_MS = 60 * 1000;
const START = Date.UTC(2026, 9, 23, 9, 0);

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Moves the clock to `minutes` after START.
function at(minutes: number) {
  vi.setSystemTime(START + minutes * MINUTE_MS);
}

// A member's Google account that allowed only Gmail, backfilled (so its watch started) and
// polled once at START.
async function watchedGmailOnly() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  const connection = await connectGoogle(orgA.member.ctx, orgA.member.email, {
    scopes: [GOOGLE_APP_SCOPES.gmail],
  });
  await backfillConnection(orgA.member.ctx, connection.id);
  await pollConnection(systemCtx(orgA.id), connection.id);
  const { ingest } = await getConnection(orgA.member.ctx, connection.id);
  expect(Object.keys(ingest)).toEqual(["gmail"]);
  expect(ingest.gmail?.watchExpiresAt?.getTime()).toBeGreaterThan(START);
  expect(ingest.gmail?.lastPolledAt?.getTime()).toBe(START);
  return { ...orgs, connection, due: [{ orgId: orgA.id, connectionId: connection.id }] };
}

describe("the sweep", () => {
  it("polls an app with a live watch 15 minutes after its last poll, not before", async () => {
    const { due } = await watchedGmailOnly();

    at(1);
    expect(await pollAllConnections()).toEqual([]);
    at(14);
    expect(await pollAllConnections()).toEqual([]);
    vi.setSystemTime(START + 15 * MINUTE_MS - 1);
    expect(await pollAllConnections()).toEqual([]);
    at(15);
    expect(await pollAllConnections()).toEqual(due);
    at(40);
    expect(await pollAllConnections()).toEqual(due);
  });

  it("starts the 15 minutes again from each poll, a push's included", async () => {
    const { orgA, connection, due } = await watchedGmailOnly();

    at(10);
    await pollConnection(systemCtx(orgA.id), connection.id);
    at(15);
    expect(await pollAllConnections()).toEqual([]);
    at(24);
    expect(await pollAllConnections()).toEqual([]);
    at(25);
    expect(await pollAllConnections()).toEqual(due);
  });

  it("polls a watched app never polled since its backfill at once", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      scopes: [GOOGLE_APP_SCOPES.gmail],
    });
    await backfillConnection(orgA.member.ctx, connection.id);

    expect(await pollAllConnections()).toEqual([{ orgId: orgA.id, connectionId: connection.id }]);
  });

  it("polls an app with no watch every minute", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      scopes: [GOOGLE_APP_SCOPES.gmail],
    });
    connection.mailbox.watches.refuseNext();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await backfillConnection(orgA.member.ctx, connection.id);
    const due = [{ orgId: orgA.id, connectionId: connection.id }];

    for (const minute of [0, 1, 2]) {
      at(minute);
      await pollConnection(systemCtx(orgA.id), connection.id);
      at(minute + 1);
      expect(await pollAllConnections()).toEqual(due);
    }
  });

  it("polls an app whose watch lapsed every minute, from the moment it lapses", async () => {
    const { orgA, connection, due } = await watchedGmailOnly();
    await recordIngestState(systemCtx(orgA.id), connection.id, "gmail", {
      watchExpiresAt: new Date(START + 5 * MINUTE_MS),
    });

    vi.setSystemTime(START + 5 * MINUTE_MS - 1);
    expect(await pollAllConnections()).toEqual([]);
    at(5);
    expect(await pollAllConnections()).toEqual(due);
    await pollConnection(systemCtx(orgA.id), connection.id);
    at(6);
    expect(await pollAllConnections()).toEqual(due);
  });

  it("polls a connection whose Gmail and Drive both watch every 15 minutes", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email);
    await backfillConnection(orgA.member.ctx, connection.id);
    await pollConnection(systemCtx(orgA.id), connection.id);
    const { ingest } = await getConnection(orgA.member.ctx, connection.id);
    expect(ingest.gmail?.watchExpiresAt?.getTime()).toBeGreaterThan(START);
    expect(ingest.drive?.watchExpiresAt?.getTime()).toBeGreaterThan(START);

    at(14);
    expect(await pollAllConnections()).toEqual([]);
    at(15);
    expect(await pollAllConnections()).toEqual([{ orgId: orgA.id, connectionId: connection.id }]);
  });

  it("polls a connection every minute when one of its apps has no watch", async () => {
    const { orgA } = await seedTwoOrgs();
    // Gmail and Drive; Drive refuses its channel, so only Gmail watches.
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email);
    connection.drive.channels.refuseNextWatch();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await backfillConnection(orgA.member.ctx, connection.id);
    await pollConnection(systemCtx(orgA.id), connection.id);
    const { ingest } = await getConnection(orgA.member.ctx, connection.id);
    expect(ingest.gmail?.watchExpiresAt?.getTime()).toBeGreaterThan(START);
    expect(ingest.drive).toMatchObject({ status: "active", watchExpiresAt: null });

    at(1);
    expect(await pollAllConnections()).toEqual([{ orgId: orgA.id, connectionId: connection.id }]);
  });

  it("never polls a connection that needs reconnecting, watched or not", async () => {
    const { orgA } = await seedTwoOrgs();
    const watched = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      scopes: [GOOGLE_APP_SCOPES.gmail],
    });
    const unwatched = await connectMailbox(orgA.admin.ctx, orgA.admin.email);
    for (const [ctx, connection] of [
      [orgA.member.ctx, watched],
      [orgA.admin.ctx, unwatched],
    ] as const) {
      await backfillConnection(ctx, connection.id);
      await deliver(fakeNango.authWebhook(connection.nangoConnectionId, "refresh", false));
    }

    for (const minute of [0, 1, 15, 60]) {
      at(minute);
      expect(await pollAllConnections()).toEqual([]);
    }
  });

  it("sweeps every org, each connection by its own apps", async () => {
    const { orgB, due } = await watchedGmailOnly();
    const inbox = await connectMailbox(
      orgB.admin.ctx,
      `support@${orgB.workspaceDomain}`,
      [],
      "org",
    );
    // Its Drive refuses a channel, so the inbox is due every minute.
    inbox.drive.channels.refuseNextWatch();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await backfillConnection(orgB.admin.ctx, inbox.id);
    await pollConnection(systemCtx(orgB.id), inbox.id);

    at(1);
    expect(await pollAllConnections()).toEqual([{ orgId: orgB.id, connectionId: inbox.id }]);
    at(15);
    const swept = await pollAllConnections();
    expect(swept).toHaveLength(2);
    expect(swept).toEqual(
      expect.arrayContaining([...due, { orgId: orgB.id, connectionId: inbox.id }]),
    );
  });
});
