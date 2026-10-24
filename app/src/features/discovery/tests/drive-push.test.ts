// Drive push, the receiving end (ADR-0026): Drive posts each change to a channel's address,
// /api/google/drive-push, with the channel's token, which names the org and connection under an
// HMAC. A verified change notification starts that connection's poll; a sync message, or one
// for a connection that's gone, needs reconnecting or has no active Drive, starts nothing. A
// token the secret didn't sign is 401. Without DRIVE_PUSH_SECRET the route isn't there.
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { env } from "@/env";
import { disconnect } from "@/features/connections/server";
import { GOOGLE_APP_SCOPES } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { connectGoogle, deliver } from "@/testing/connect-helpers";
import { postToRoute } from "@/testing/fake-drive-channels";
import { fakeInngest } from "@/testing/fake-inngest";
import { fakeNango } from "@/testing/fake-nango";
import { pollCron } from "../jobs";
import { backfillConnection, sweepSchedule } from "../server";

beforeEach(resetDatabase);

const ADDRESS = "http://localhost:3000/api/google/drive-push";

const polled = () => fakeInngest.sent("discovery/connection.poll-due").map((event) => event.data);

// A Google account that allowed only Drive, backfilled, so its channel is open.
async function watchedDrive(ctx: Ctx, email: string) {
  const connection = await connectGoogle(ctx, email, { scopes: [GOOGLE_APP_SCOPES.drive] });
  await backfillConnection(ctx, connection.id);
  return { ...connection, channel: connection.drive.channels.latest() };
}

// A token as a channel carries it, signed with `secret`.
function token(orgId: string, connectionId: string, secret = env.DRIVE_PUSH_SECRET ?? "") {
  const mac = createHmac("sha256", secret).update(`${orgId}.${connectionId}`).digest("base64url");
  return `${orgId}.${connectionId}.${mac}`;
}

// Posts a change notification carrying `channelToken` (none when null), as a forger might.
function postWith(channelToken: string | null, state = "change") {
  const headers = new Headers({
    "X-Goog-Channel-ID": "4ba78bf0-6a47-11e2-bcfd-0800200c9a66",
    "X-Goog-Resource-ID": "ret08u3rv24htgh289g",
    "X-Goog-Resource-State": state,
    "X-Goog-Message-Number": "2",
  });
  if (channelToken !== null) headers.set("X-Goog-Channel-Token", channelToken);
  return postToRoute(ADDRESS, headers);
}

// Runs `work` as a deployment without these settings would: the env is parsed once at startup.
async function without<T>(keys: (keyof typeof env)[], work: () => Promise<T> | T): Promise<T> {
  const saved = keys.map((key) => [key, env[key]] as const);
  for (const key of keys) Object.assign(env, { [key]: undefined });
  try {
    return await work();
  } finally {
    for (const [key, value] of saved) Object.assign(env, { [key]: value });
  }
}

describe("a Drive notification", () => {
  it("starts one poll of its connection", async () => {
    const { orgA } = await seedTwoOrgs();
    const { id, drive, channel } = await watchedDrive(orgA.member.ctx, orgA.member.email);

    expect((await drive.channels.notify(channel)).status).toBe(204);

    expect(polled()).toEqual([{ orgId: orgA.id, connectionId: id }]);
  });

  it("starts nothing for the sync message a channel sends when it opens", async () => {
    const { orgA } = await seedTwoOrgs();
    const { drive, channel } = await watchedDrive(orgA.member.ctx, orgA.member.email);

    expect((await drive.channels.notify(channel, "sync")).status).toBe(204);

    expect(polled()).toEqual([]);
  });

  it("is 401 and starts nothing with a token the secret didn't sign", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const own = await watchedDrive(orgA.member.ctx, orgA.member.email);
    const other = await watchedDrive(orgB.member.ctx, orgB.member.email);
    const [, , ownMac] = (own.channel.token ?? "").split(".");
    const [, , otherMac] = (other.channel.token ?? "").split(".");
    const forged = [
      null,
      "",
      "not-a-token",
      token(orgA.id, own.id, "another-secret-that-is-at-least-32-chars"),
      `${orgA.id}.${own.id}.${ownMac.slice(1)}x`,
      // Another org's channel token, pointed at this org, and the other way round.
      `${orgA.id}.${other.id}.${otherMac}`,
      `${orgB.id}.${own.id}.${ownMac}`,
      `${orgA.id}.${own.id}.${ownMac}.extra`,
    ];

    for (const channelToken of forged) {
      expect((await postWith(channelToken)).status, String(channelToken)).toBe(401);
    }
    expect((await postWith(null, "sync")).status).toBe(401);

    expect(polled()).toEqual([]);
  });

  it("starts nothing for a connection that was deleted", async () => {
    const { orgA } = await seedTwoOrgs();
    const { id, drive, channel } = await watchedDrive(orgA.member.ctx, orgA.member.email);
    await disconnect(orgA.member.ctx, id);

    // The channel was never stopped: Drive keeps posting until it runs out (ADR-0026).
    expect((await drive.channels.notify(channel)).status).toBe(204);

    expect(polled()).toEqual([]);
  });

  it("starts nothing for a connection that needs reconnecting", async () => {
    const { orgA } = await seedTwoOrgs();
    const watched = await watchedDrive(orgA.member.ctx, orgA.member.email);
    await deliver(fakeNango.authWebhook(watched.nangoConnectionId, "refresh", false));

    expect((await watched.drive.channels.notify(watched.channel)).status).toBe(204);

    expect(polled()).toEqual([]);
  });

  it("starts nothing for a connection whose Drive isn't active", async () => {
    const { orgA } = await seedTwoOrgs();
    const backfilling = await connectGoogle(orgA.member.ctx, orgA.member.email);
    const gmailOnly = await connectGoogle(orgA.admin.ctx, orgA.admin.email, {
      scopes: [GOOGLE_APP_SCOPES.gmail],
    });
    await backfillConnection(orgA.admin.ctx, gmailOnly.id);

    for (const id of [backfilling.id, gmailOnly.id]) {
      expect((await postWith(token(orgA.id, id))).status).toBe(204);
    }

    expect(polled()).toEqual([]);
  });
});

describe("without DRIVE_PUSH_SECRET", () => {
  it("the route is 404, signed or not, and starts nothing", async () => {
    const { orgA } = await seedTwoOrgs();
    const { drive, channel } = await watchedDrive(orgA.member.ctx, orgA.member.email);

    await without(["DRIVE_PUSH_SECRET"], async () => {
      expect((await drive.channels.notify(channel)).status).toBe(404);
      expect((await postWith(null)).status).toBe(404);
    });

    expect(polled()).toEqual([]);
  });
});

describe("the sweep cron", () => {
  it("runs every 5 minutes once Gmail and Drive both push", () => {
    expect(pollCron.opts.triggers).toEqual([{ cron: "*/5 * * * *" }]);
    expect(sweepSchedule()).toBe("*/5 * * * *");
  });

  it("runs every minute while an ingested app has no push", async () => {
    expect(await without(["DRIVE_PUSH_SECRET"], sweepSchedule)).toBe("* * * * *");
    expect(await without(["GMAIL_PUSH_TOPIC"], sweepSchedule)).toBe("* * * * *");
  });
});
