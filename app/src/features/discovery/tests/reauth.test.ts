// A connection whose token Google stopped refreshing: it shows it needs reconnecting, polling
// skips it, and reconnecting picks up where it left off, its backfill included if that failed.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { handleNangoWebhook, listConnections, startReconnect } from "@/features/connections/server";
import { systemCtx } from "@/lib/ctx";
import { fakeInngest } from "@/testing/fake-inngest";
import { fakeNango } from "@/testing/fake-nango";
import {
  backfillConnection,
  findEventsByObject,
  markBackfillFailed,
  pollAllConnections,
  pollConnection,
} from "../server";
import { connectMailbox, daysAgo, listed } from "@/testing/connect-helpers";

beforeEach(resetDatabase);

const LATE = "late@customer.example";

async function deliver(webhook: { rawBody: string; headers: Headers }) {
  expect(await handleNangoWebhook(webhook.rawBody, webhook.headers)).toEqual({ status: 200 });
}

async function refreshFailed() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  const me = orgA.member.email;
  const connection = await connectMailbox(orgA.member.ctx, me, [
    { from: "alice@customer.example", to: [me], text: "Hi", at: daysAgo(2) },
  ]);
  await backfillConnection(orgA.member.ctx, connection.id);
  await deliver(fakeNango.authWebhook(connection.nangoConnectionId, "refresh", false));
  connection.mailbox.add({ from: LATE, to: [me], text: "While it was down", at: new Date() });
  return { ...orgs, connection, ctx: orgA.member.ctx };
}

describe("a failed token refresh", () => {
  it("shows the connection needs reconnecting, to its owner and to admins", async () => {
    const { orgA, connection, ctx } = await refreshFailed();

    expect(await listed(ctx, connection.id)).toMatchObject({ status: "needs_reauth" });
    const admins = await listConnections(orgA.admin.ctx);
    expect(admins.memberConnections).toEqual([
      expect.objectContaining({ id: connection.id, status: "needs_reauth" }),
    ]);
  });

  it("stops polling the connection", async () => {
    const { orgA, connection, ctx } = await refreshFailed();

    expect(await pollAllConnections()).toEqual([]);
    expect(await pollConnection(systemCtx(orgA.id), connection.id)).toEqual({
      outcome: "skipped",
    });
    expect(await findEventsByObject(ctx, "email", LATE)).toEqual([]);
  });

  it("clears once the owner reconnects, and polling picks up what arrived meanwhile", async () => {
    const { orgA, connection, ctx } = await refreshFailed();

    const { token } = await startReconnect(ctx, connection.id);
    await deliver(fakeNango.completeReconnect(token));

    expect(await listed(ctx, connection.id)).toMatchObject({ status: "active" });
    expect(await pollAllConnections()).toEqual([{ orgId: orgA.id, connectionId: connection.id }]);
    expect(await pollConnection(systemCtx(orgA.id), connection.id)).toEqual({
      outcome: "polled",
      items: 1,
    });
    expect(await findEventsByObject(ctx, "email", LATE)).toHaveLength(1);
    // Its backfill had finished, so the reconnect starts no other.
    expect(fakeInngest.sent("connections/apps.granted")).toEqual([]);
  });

  it("clears when Nango later refreshes the token after all", async () => {
    const { connection, ctx } = await refreshFailed();

    await deliver(fakeNango.authWebhook(connection.nangoConnectionId, "refresh", true));

    expect(await listed(ctx, connection.id)).toMatchObject({ status: "active" });
  });
});

describe("a failed token refresh during the first backfill", () => {
  it("still shows the connection needs reconnecting once the backfill finishes", async () => {
    const { orgA } = await seedTwoOrgs();
    const me = orgA.member.email;
    const ctx = orgA.member.ctx;
    const connection = await connectMailbox(ctx, me, [
      { from: "alice@customer.example", to: [me], text: "Hi", at: daysAgo(2) },
    ]);
    // Nango reports the failed refresh while the backfill is reading the mailbox.
    let reported = false;
    fakeNango.beforeProxy(async () => {
      if (reported) return;
      reported = true;
      await deliver(fakeNango.authWebhook(connection.nangoConnectionId, "refresh", false));
    });

    expect(await backfillConnection(ctx, connection.id)).toEqual({ outcome: "done", items: 1 });

    expect(reported).toBe(true);
    expect(await listed(ctx, connection.id)).toMatchObject({ status: "needs_reauth" });
    expect(await pollAllConnections()).toEqual([]);
  });
});

describe("reconnecting a connection whose backfill failed", () => {
  // Google stops refreshing the token before the backfill can read anything, so the backfill
  // job runs out of retries and gives up.
  async function backfillFailed() {
    const orgs = await seedTwoOrgs();
    const me = orgs.orgA.member.email;
    const ctx = orgs.orgA.member.ctx;
    const connection = await connectMailbox(ctx, me, [
      { from: "alice@customer.example", to: [me], text: "Hi", at: daysAgo(2) },
    ]);
    fakeNango.revokeAccess(connection.nangoConnectionId);
    await deliver(fakeNango.authWebhook(connection.nangoConnectionId, "refresh", false));
    await expect(backfillConnection(ctx, connection.id)).rejects.toThrow();
    await markBackfillFailed(ctx, connection.id);
    return { ...orgs, connection, ctx };
  }

  it("backfills its history again", async () => {
    const { orgA, connection, ctx } = await backfillFailed();

    const { token } = await startReconnect(ctx, connection.id);
    await deliver(fakeNango.completeReconnect(token));

    expect(await listed(ctx, connection.id)).toMatchObject({ status: "backfilling" });
    expect(fakeInngest.sent("connections/apps.granted")).toEqual([
      expect.objectContaining({
        data: { orgId: orgA.id, userId: "system", role: "system", connectionId: connection.id },
      }),
    ]);
    expect(await backfillConnection(systemCtx(orgA.id), connection.id)).toEqual({
      outcome: "done",
      items: 1,
    });
    expect(await listed(ctx, connection.id)).toMatchObject({ status: "active" });
    expect(await findEventsByObject(ctx, "email", "alice@customer.example")).toHaveLength(1);
  });

  it("restarts it on Nango's redelivery when the first announcement failed", async () => {
    const { connection, ctx } = await backfillFailed();
    const { token } = await startReconnect(ctx, connection.id);
    const override = fakeNango.completeReconnect(token);

    fakeInngest.failSends();
    await expect(deliver(override)).rejects.toThrow();
    fakeInngest.failSends(false);
    // Until Nango delivers it again, the owner still sees the backfill failed.
    expect(await listed(ctx, connection.id)).toMatchObject({ status: "failed" });

    await deliver(override);
    await deliver(override);

    expect(fakeInngest.sent("connections/apps.granted")).toHaveLength(1);
    expect(await listed(ctx, connection.id)).toMatchObject({ status: "backfilling" });
  });
});
