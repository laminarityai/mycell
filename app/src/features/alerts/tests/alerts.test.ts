// Admins' alerts, worked out from Mycel's current state: each appears while its cause holds and
// goes away by itself once it's fixed, with nothing stored and nothing to dismiss.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { startReconnect } from "@/features/connections/server";
import { grantCredits, recordUsage } from "@/features/credits/server";
import { backfillConnection, markBackfillFailed } from "@/features/discovery/server";
import { type Ctx, systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { connectGoogle, connectMailbox, daysAgo, deliver } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { countAlerts, listAlerts } from "../server";

beforeEach(resetDatabase);

/** Credits used now, as a model call records them (1,000 credits a dollar). */
async function use(orgId: string, credits: number) {
  await recordUsage(systemCtx(orgId), {
    role: "fast",
    modelId: "openai/x",
    costUsd: credits / 1000,
    outcome: "succeeded",
    purpose: "builder",
  });
}

const kindsOf = async (ctx: Ctx) => (await listAlerts(ctx)).map((alert) => alert.kind);

/** Org A, funded so that credits raise no alert unless a test spends them. */
async function fundedOrgs() {
  const orgs = await seedTwoOrgs();
  await grantCredits(systemCtx(orgs.orgA.id), 10_000, "October allowance");
  return orgs;
}

describe("credit alerts", () => {
  it("says credits are out at a zero balance, and goes once credits are granted", async () => {
    const { orgA } = await seedTwoOrgs();

    expect(await listAlerts(orgA.admin.ctx)).toEqual([
      {
        id: "credits_out",
        kind: "credits_out",
        subject: { type: "credits" },
        startedAt: null,
        sentence: expect.stringContaining("Every workflow is paused") as string,
        clearsWhen: "Once credits are granted.",
        fix: { label: "See credits", href: "/credits" },
      },
    ]);
    expect(await countAlerts(orgA.admin.ctx)).toBe(1);

    await grantCredits(systemCtx(orgA.id), 100, "Top-up");

    expect(await listAlerts(orgA.admin.ctx)).toEqual([]);
    expect(await countAlerts(orgA.admin.ctx)).toBe(0);
  });

  it("says credits are low under 7 days at this week's rate, and goes once more are granted", async () => {
    const { orgA } = await seedTwoOrgs();
    await grantCredits(systemCtx(orgA.id), 100, "October allowance");
    // 30 used this week leaves 70, at about 4.3 a day: 16 days.
    await use(orgA.id, 30);
    expect(await kindsOf(orgA.admin.ctx)).toEqual([]);

    // 70 used this week leaves 30, at 10 a day: 3 days.
    await use(orgA.id, 40);

    expect(await listAlerts(orgA.admin.ctx)).toEqual([
      expect.objectContaining({
        kind: "credits_low",
        subject: { type: "credits" },
        startedAt: null,
        sentence: "At this week's rate (10 a day), the 30 credits left last about 3 days.",
        clearsWhen: "Once more than 7 days are left.",
        fix: { label: "See credits", href: "/credits" },
      }),
    ]);

    await grantCredits(systemCtx(orgA.id), 1000, "Top-up");
    expect(await kindsOf(orgA.admin.ctx)).toEqual([]);
  });

  it("says only that credits are out once they're gone, not that they're low too", async () => {
    const { orgA } = await seedTwoOrgs();
    await grantCredits(systemCtx(orgA.id), 100, "October allowance");
    await use(orgA.id, 120);

    expect(await kindsOf(orgA.admin.ctx)).toEqual(["credits_out"]);
  });

  it("raises none for credits with no usage this week", async () => {
    const { orgA } = await fundedOrgs();

    expect(await kindsOf(orgA.admin.ctx)).toEqual([]);
  });
});

describe("connection alerts", () => {
  it("says an org connection and the admin's own need reconnecting, never a colleague's", async () => {
    const { orgA } = await fundedOrgs();
    const support = `support@${orgA.workspaceDomain}`;
    const shared = await connectGoogle(orgA.admin.ctx, support, { kind: "org" });
    const mine = await connectGoogle(orgA.admin.ctx, orgA.admin.email);
    const theirs = await connectGoogle(orgA.member.ctx, orgA.member.email);
    for (const connection of [shared, mine, theirs]) {
      await deliver(fakeNango.authWebhook(connection.nangoConnectionId, "refresh", false));
    }

    expect(await listAlerts(orgA.admin.ctx)).toEqual([
      {
        id: `connection_reconnect:${mine.id}`,
        kind: "connection_reconnect",
        subject: {
          type: "connection",
          id: mine.id,
          source: "google",
          kind: "member",
          accountEmail: orgA.admin.email,
        },
        startedAt: null,
        sentence: `Google stopped accepting Mycel's access to ${orgA.admin.email}, so nothing runs on it.`,
        clearsWhen: "Once it's reconnected.",
        fix: { label: "Reconnect", href: "/connections" },
      },
      expect.objectContaining({
        id: `connection_reconnect:${shared.id}`,
        subject: expect.objectContaining({ kind: "org", accountEmail: support }) as unknown,
      }),
    ]);
  });

  it("goes once the connection is reconnected", async () => {
    const { orgA } = await fundedOrgs();
    const shared = await connectGoogle(orgA.admin.ctx, `support@${orgA.workspaceDomain}`, {
      kind: "org",
    });
    await deliver(fakeNango.authWebhook(shared.nangoConnectionId, "refresh", false));
    expect(await countAlerts(orgA.admin.ctx)).toBe(1);

    const { token } = await startReconnect(orgA.admin.ctx, shared.id);
    await deliver(fakeNango.completeReconnect(token));

    expect(await countAlerts(orgA.admin.ctx)).toBe(0);
  });

  it("says a backfill failed, and goes once a reconnect's backfill succeeds", async () => {
    const { orgA } = await fundedOrgs();
    const support = `support@${orgA.workspaceDomain}`;
    const shared = await connectMailbox(
      orgA.admin.ctx,
      support,
      [{ from: "alice@customer.example", to: [support], text: "Hi", at: daysAgo(2) }],
      "org",
    );
    await markBackfillFailed(systemCtx(orgA.id), shared.id);

    expect(await listAlerts(orgA.admin.ctx)).toEqual([
      expect.objectContaining({
        id: `backfill_failed:${shared.id}`,
        kind: "backfill_failed",
        sentence: `Mycel couldn't finish reading ${support}'s history, so discovery and memory are missing it.`,
        clearsWhen: "Once its history is read.",
        fix: { label: "Reconnect to retry", href: "/connections" },
      }),
    ]);

    const { token } = await startReconnect(orgA.admin.ctx, shared.id);
    await deliver(fakeNango.completeReconnect(token));
    await backfillConnection(systemCtx(orgA.id), shared.id);

    expect(await listAlerts(orgA.admin.ctx)).toEqual([]);
  });
});

describe("who gets alerts", () => {
  it("lists the most urgent first", async () => {
    const { orgA } = await seedTwoOrgs();
    const mine = await connectGoogle(orgA.admin.ctx, orgA.admin.email);
    const shared = await connectGoogle(orgA.admin.ctx, `support@${orgA.workspaceDomain}`, {
      kind: "org",
    });
    await markBackfillFailed(systemCtx(orgA.id), mine.id);
    await deliver(fakeNango.authWebhook(shared.nangoConnectionId, "refresh", false));

    expect(await kindsOf(orgA.admin.ctx)).toEqual([
      "credits_out",
      "connection_reconnect",
      "backfill_failed",
    ]);
  });

  it("gives members none", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(listAlerts(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
    await expect(countAlerts(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
  });
});
