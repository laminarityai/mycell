// A connection whose token Google stopped refreshing: it shows it needs reconnecting, polling
// skips it, and reconnecting picks up where it left off.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { handleNangoWebhook, listConnections, startReconnect } from "@/features/connections/server";
import { systemCtx } from "@/lib/ctx";
import { fakeNango } from "@/testing/fake-nango";
import {
  backfillConnection,
  findEventsByObject,
  pollAllConnections,
  pollConnection,
} from "../server";
import { connectMailbox, daysAgo, listed } from "./ingest-helpers";

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
  });

  it("clears when Nango later refreshes the token after all", async () => {
    const { connection, ctx } = await refreshFailed();

    await deliver(fakeNango.authWebhook(connection.nangoConnectionId, "refresh", true));

    expect(await listed(ctx, connection.id)).toMatchObject({ status: "active" });
  });
});
