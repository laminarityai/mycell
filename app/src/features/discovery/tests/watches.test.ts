// Watches (ADR-0026): Gmail's starts when its backfill finishes, its expiry is stored on the app's
// ingest state, and the daily renewal renews every active one, restarting those that lapsed or
// never started. A failed watch leaves the app to polling. Without push configured, no watch
// call is made.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { env } from "@/env";
import {
  disconnect,
  getConnection,
  proxyPost,
  recordIngestState,
} from "@/features/connections/server";
import { GOOGLE_APP_SCOPES, SourceRequestError } from "@/features/connections/types";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import type { RunStep } from "@/lib/inngest";
import { connectGoogle, connectMailbox, daysAgo, deliver } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { z } from "zod";
import { renewWatchesJob } from "../jobs";
import { backfillConnection, renewWatches } from "../server";

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

const TOPIC = "projects/mycel-test/topics/gmail-push";
const LABEL_FILTER = { labelFilterBehavior: "exclude", labelIds: ["DRAFT", "SPAM", "TRASH"] };

const PUSH_KEYS = [
  "GMAIL_PUSH_TOPIC",
  "GOOGLE_PUSH_AUDIENCE",
  "GOOGLE_PUSH_SERVICE_ACCOUNT",
] as const;

// Runs `work` as a deployment without push would: the env is parsed once at startup.
async function withoutPush<T>(work: () => Promise<T>): Promise<T> {
  const saved = PUSH_KEYS.map((key) => [key, env[key]] as const);
  for (const key of PUSH_KEYS) env[key] = undefined;
  try {
    return await work();
  } finally {
    for (const [key, value] of saved) env[key] = value;
  }
}

// What a failed watch logs, kept from the test's output.
function warnings(): unknown[][] {
  const logged: unknown[][] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
  return logged;
}

async function watchExpiry(ctx: Ctx, connectionId: string, app: "gmail" | "drive" = "gmail") {
  return (await getConnection(ctx, connectionId)).ingest[app]?.watchExpiresAt;
}

// A Google account that allowed only Drive.
function connectDriveOnly(ctx: Ctx, email: string, kind: "member" | "org" = "member") {
  return connectGoogle(ctx, email, { kind, scopes: [GOOGLE_APP_SCOPES.drive] });
}

// When the latest watch the mailbox was asked for expires, as Gmail answered it.
function answeredExpiry(mailbox: { watches: { made: { expiration: string }[] } }) {
  const latest = mailbox.watches.made.at(-1);
  if (latest === undefined) throw new Error("The mailbox was never watched");
  return new Date(Number(latest.expiration));
}

describe("finishing a Gmail backfill", () => {
  it("starts a watch with the topic and label filter, and stores its expiry", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email);
    const steps: string[] = [];
    const recording: RunStep = (id, run) => {
      steps.push(id);
      return run();
    };

    expect(await backfillConnection(orgA.member.ctx, connection.id, recording)).toMatchObject({
      outcome: "done",
    });

    expect(connection.mailbox.watches.made).toEqual([
      { topicName: TOPIC, ...LABEL_FILTER, expiration: expect.any(String) as string },
    ]);
    const expiry = await watchExpiry(orgA.member.ctx, connection.id);
    expect(expiry).toEqual(answeredExpiry(connection.mailbox));
    expect(expiry?.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    expect(steps.indexOf("gmail-watch")).toBe(steps.indexOf("gmail-finish") + 1);
    expect(steps).not.toContain("drive-watch");
  });

  it("leaves Drive, which has no watch yet, untouched", async () => {
    const { orgA } = await seedTwoOrgs();
    const drive = await connectDriveOnly(orgA.member.ctx, orgA.member.email);
    const google = await connectMailbox(orgA.admin.ctx, orgA.admin.email);

    await backfillConnection(orgA.member.ctx, drive.id);
    await backfillConnection(orgA.admin.ctx, google.id);

    expect(drive.mailbox.watches.made).toEqual([]);
    expect(await watchExpiry(orgA.member.ctx, drive.id, "drive")).toBeNull();
    expect(await watchExpiry(orgA.admin.ctx, google.id, "drive")).toBeNull();
    expect(google.mailbox.watches.made).toHaveLength(1);
  });

  it("leaves Gmail active with no expiry when the watch fails, and logs it", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      { from: "alice@customer.example", to: [orgA.member.email], text: "Hi", at: daysAgo(1) },
    ]);
    connection.mailbox.watches.refuseNext();
    const logged = warnings();

    expect(await backfillConnection(orgA.member.ctx, connection.id)).toEqual({
      outcome: "done",
      items: 1,
    });

    const { ingest } = await getConnection(orgA.member.ctx, connection.id);
    expect(ingest.gmail).toMatchObject({ status: "active", watchExpiresAt: null });
    expect(logged).toHaveLength(1);
    expect(String(logged[0]?.[0])).toContain(connection.id);
  });

  it("makes no watch call without push configured", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email);

    await withoutPush(() => backfillConnection(orgA.member.ctx, connection.id));

    expect(connection.mailbox.watches.made).toEqual([]);
    expect(await watchExpiry(orgA.member.ctx, connection.id)).toBeNull();
  });
});

describe("renewWatches", () => {
  it("renews live watches and restarts lapsed and missing ones", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = systemCtx(orgA.id);
    const live = await connectMailbox(orgA.member.ctx, orgA.member.email);
    const lapsed = await connectMailbox(orgA.admin.ctx, orgA.admin.email);
    const missing = await connectMailbox(
      orgA.admin.ctx,
      `support@${orgA.workspaceDomain}`,
      [],
      "org",
    );
    await backfillConnection(orgA.member.ctx, live.id);
    await backfillConnection(orgA.admin.ctx, lapsed.id);
    await recordIngestState(ctx, lapsed.id, "gmail", { watchExpiresAt: daysAgo(1) });
    await withoutPush(() => backfillConnection(orgA.admin.ctx, missing.id));

    expect(await renewWatches(ctx)).toEqual({ renewed: 3, failed: 0 });

    for (const connection of [live, lapsed, missing]) {
      expect(connection.mailbox.watches.made.at(-1)).toMatchObject({
        topicName: TOPIC,
        ...LABEL_FILTER,
      });
      expect(await watchExpiry(ctx, connection.id)).toEqual(answeredExpiry(connection.mailbox));
    }
    expect(live.mailbox.watches.made).toHaveLength(2);
    expect(missing.mailbox.watches.made).toHaveLength(1);
  });

  it("skips connections needing reconnect, still backfilling, or without Gmail", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = systemCtx(orgA.id);
    const reauth = await connectMailbox(orgA.member.ctx, orgA.member.email);
    await backfillConnection(orgA.member.ctx, reauth.id);
    await deliver(fakeNango.authWebhook(reauth.nangoConnectionId, "refresh", false));
    const backfilling = await connectMailbox(orgA.admin.ctx, orgA.admin.email);
    const drive = await connectDriveOnly(orgA.admin.ctx, `support@${orgA.workspaceDomain}`, "org");
    await backfillConnection(orgA.admin.ctx, drive.id);

    expect(await renewWatches(ctx)).toEqual({ renewed: 0, failed: 0 });

    expect(reauth.mailbox.watches.made).toHaveLength(1);
    expect(backfilling.mailbox.watches.made).toEqual([]);
    expect(drive.mailbox.watches.made).toEqual([]);
  });

  it("logs a failed renewal and renews the rest, keeping the failed one's expiry", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = systemCtx(orgA.id);
    const failing = await connectMailbox(orgA.member.ctx, orgA.member.email);
    const fine = await connectMailbox(orgA.admin.ctx, orgA.admin.email);
    await backfillConnection(orgA.member.ctx, failing.id);
    await backfillConnection(orgA.admin.ctx, fine.id);
    const before = await watchExpiry(ctx, failing.id);
    failing.mailbox.watches.refuseNext();
    const logged = warnings();

    expect(await renewWatches(ctx)).toEqual({ renewed: 1, failed: 1 });

    expect(fine.mailbox.watches.made).toHaveLength(2);
    expect(await watchExpiry(ctx, fine.id)).toEqual(answeredExpiry(fine.mailbox));
    // The old watch still runs until then; the sweep polls the app after it lapses.
    expect(await watchExpiry(ctx, failing.id)).toEqual(before);
    expect(logged).toHaveLength(1);
    expect(String(logged[0]?.[0])).toContain(failing.id);
  });

  it("makes no watch call without push configured", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email);
    await backfillConnection(orgA.member.ctx, connection.id);

    expect(await withoutPush(() => renewWatches(systemCtx(orgA.id)))).toEqual({
      renewed: 0,
      failed: 0,
    });

    expect(connection.mailbox.watches.made).toHaveLength(1);
  });

  it("is for the org's system ctx only", async () => {
    const { orgA } = await seedTwoOrgs();

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      await expect(renewWatches(ctx)).rejects.toThrow(ForbiddenError);
    }
  });
});

describe("the renew-watches job", () => {
  it("runs daily at 04:00 UTC, after the reconciliation, one run at a time", () => {
    expect(renewWatchesJob.opts.triggers).toEqual([{ cron: "TZ=UTC 0 4 * * *" }]);
    expect(renewWatchesJob.opts.concurrency).toEqual([{ limit: 1 }]);
  });
});

describe("a watched connection", () => {
  it("leaves no expiry behind when it's disconnected", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email);
    await backfillConnection(orgA.member.ctx, connection.id);
    expect(await watchExpiry(orgA.member.ctx, connection.id)).toBeInstanceOf(Date);
    expect(await tablesHolding(connection.id)).toContain("ingest_states");

    await disconnect(orgA.member.ctx, connection.id);

    expect(await tablesHolding(connection.id)).toEqual([]);
  });
});

describe("the fake Gmail's users.watch", () => {
  it("refuses an account without a Gmail scope, as Google does", async () => {
    const { orgA } = await seedTwoOrgs();
    const drive = await connectDriveOnly(orgA.member.ctx, orgA.member.email);
    const answer = z.object({ historyId: z.string(), expiration: z.string() });

    const watching = proxyPost(
      orgA.member.ctx,
      drive.id,
      "/gmail/v1/users/me/watch",
      { topicName: TOPIC },
      answer,
    );

    await expect(watching).rejects.toThrow(SourceRequestError);
    await expect(watching).rejects.toMatchObject({ status: 403 });
  });
});
