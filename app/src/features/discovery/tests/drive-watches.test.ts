// Drive's watch (ADR-0026): a changes.watch web-hook channel on the account's changes feed,
// opened when Drive's backfill finishes, from Drive's cursor, with a token naming the org and
// connection. Its ID, resource ID and expiry are stored on Drive's ingest state. The daily
// renewal opens a new channel, then stops the old one. Without DRIVE_PUSH_SECRET no channel opens.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { env } from "@/env";
import { disconnect, getConnection, proxyPost } from "@/features/connections/server";
import { GOOGLE_APP_SCOPES, SourceRequestError } from "@/features/connections/types";
import { systemCtx, type Ctx } from "@/lib/ctx";
import type { RunStep } from "@/lib/inngest";
import { connectGoogle } from "@/testing/connect-helpers";
import { z } from "zod";
import { backfillConnection, renewWatches } from "../server";

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

const ADDRESS = "http://localhost:3000/api/google/drive-push";
const DAY_MS = 24 * 60 * 60 * 1000;

// Runs `work` as a deployment without Drive push would: the env is parsed once at startup.
async function withoutDrivePush<T>(work: () => Promise<T>): Promise<T> {
  const saved = env.DRIVE_PUSH_SECRET;
  env.DRIVE_PUSH_SECRET = undefined;
  try {
    return await work();
  } finally {
    env.DRIVE_PUSH_SECRET = saved;
  }
}

// What a failed call logs, kept from the test's output.
function warnings(): unknown[][] {
  const logged: unknown[][] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
  return logged;
}

// A Google account that allowed only Drive.
function connectDriveOnly(ctx: Ctx, email: string) {
  return connectGoogle(ctx, email, { scopes: [GOOGLE_APP_SCOPES.drive] });
}

async function driveState(ctx: Ctx, connectionId: string) {
  return (await getConnection(ctx, connectionId)).ingest.drive;
}

// The channel as Drive's ingest state records it.
function recorded(channel: { id: string; resourceId: string; expiration: string }) {
  return {
    watchChannelId: channel.id,
    watchResourceId: channel.resourceId,
    watchExpiresAt: new Date(Number(channel.expiration)),
  };
}

describe("finishing a Drive backfill", () => {
  it("opens a channel on the changes feed from Drive's cursor, and stores it", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectDriveOnly(orgA.member.ctx, orgA.member.email);
    const steps: string[] = [];
    const recording: RunStep = (id, run) => {
      steps.push(id);
      return run();
    };

    await backfillConnection(orgA.member.ctx, connection.id, recording);

    expect(connection.drive.channels.opened).toHaveLength(1);
    const channel = connection.drive.channels.latest();
    const state = await driveState(orgA.member.ctx, connection.id);
    expect(channel).toMatchObject({ address: ADDRESS, pageToken: state?.cursor, stopped: false });
    expect(channel.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const signed = `${orgA.id}.${connection.id}`;
    const mac = createHmac("sha256", env.DRIVE_PUSH_SECRET ?? "")
      .update(signed)
      .digest("base64url");
    expect(channel.token).toBe(`${signed}.${mac}`);
    expect(channel.token?.length).toBeLessThanOrEqual(256);
    const lasts = Number(channel.expiration) - Date.now();
    expect(lasts).toBeGreaterThan(7 * DAY_MS - 60 * 60 * 1000);
    expect(lasts).toBeLessThanOrEqual(7 * DAY_MS);
    expect(state).toMatchObject({ status: "active", ...recorded(channel) });
    expect(steps.indexOf("drive-watch")).toBe(steps.indexOf("drive-finish") + 1);
  });

  it("leaves Drive active and unwatched when Drive refuses the channel, and logs it", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectDriveOnly(orgA.member.ctx, orgA.member.email);
    connection.drive.channels.refuseNextWatch();
    const logged = warnings();

    expect(await backfillConnection(orgA.member.ctx, connection.id)).toMatchObject({
      outcome: "done",
    });

    expect(await driveState(orgA.member.ctx, connection.id)).toMatchObject({
      status: "active",
      watchChannelId: null,
      watchResourceId: null,
      watchExpiresAt: null,
    });
    expect(logged).toHaveLength(1);
    expect(String(logged[0]?.[0])).toContain(connection.id);
  });

  it("opens no channel without DRIVE_PUSH_SECRET, and still watches Gmail", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectGoogle(orgA.member.ctx, orgA.member.email);

    await withoutDrivePush(() => backfillConnection(orgA.member.ctx, connection.id));

    expect(connection.drive.channels.opened).toEqual([]);
    const { ingest } = await getConnection(orgA.member.ctx, connection.id);
    expect(ingest.drive).toMatchObject({ status: "active", watchExpiresAt: null });
    expect(connection.mailbox.watches.made).toHaveLength(1);
  });
});

describe("renewing a Drive channel", () => {
  async function watchedDrive() {
    const orgs = await seedTwoOrgs();
    const connection = await connectDriveOnly(orgs.orgA.member.ctx, orgs.orgA.member.email);
    await backfillConnection(orgs.orgA.member.ctx, connection.id);
    return { ...orgs, ctx: systemCtx(orgs.orgA.id), connection };
  }

  it("opens a new channel, then stops the old one", async () => {
    const { ctx, connection } = await watchedDrive();
    const old = connection.drive.channels.latest();

    expect(await renewWatches(ctx)).toEqual({ renewed: 1, failed: 0 });

    const { channels } = connection.drive;
    expect(channels.opened).toHaveLength(2);
    const renewed = channels.latest();
    expect(renewed.id).not.toBe(old.id);
    expect(old.stopped).toBe(true);
    expect(channels.live()).toEqual([renewed]);
    expect(await driveState(ctx, connection.id)).toMatchObject(recorded(renewed));
  });

  it("keeps the new channel when stopping the old one fails, and logs it", async () => {
    const { ctx, connection } = await watchedDrive();
    const old = connection.drive.channels.latest();
    connection.drive.channels.failNextStop();
    const logged = warnings();

    expect(await renewWatches(ctx)).toEqual({ renewed: 1, failed: 0 });

    // The old channel runs out on its own.
    const renewed = connection.drive.channels.latest();
    expect(connection.drive.channels.live()).toEqual([old, renewed]);
    expect(await driveState(ctx, connection.id)).toMatchObject(recorded(renewed));
    expect(logged).toHaveLength(1);
    expect(String(logged[0]?.[0])).toContain(connection.id);
  });

  it("keeps the old channel, unstopped, when Drive refuses the new one", async () => {
    const { ctx, connection } = await watchedDrive();
    const old = connection.drive.channels.latest();
    connection.drive.channels.refuseNextWatch();
    warnings();

    expect(await renewWatches(ctx)).toEqual({ renewed: 0, failed: 1 });

    expect(connection.drive.channels.live()).toEqual([old]);
    expect(await driveState(ctx, connection.id)).toMatchObject(recorded(old));
  });

  it("makes no Drive call without DRIVE_PUSH_SECRET", async () => {
    const { ctx, connection } = await watchedDrive();

    expect(await withoutDrivePush(() => renewWatches(ctx))).toEqual({ renewed: 0, failed: 0 });

    expect(connection.drive.channels.opened).toHaveLength(1);
  });
});

describe("a connection with a Drive channel", () => {
  it("leaves nothing of the channel behind when it's disconnected", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectDriveOnly(orgA.member.ctx, orgA.member.email);
    await backfillConnection(orgA.member.ctx, connection.id);
    expect((await driveState(orgA.member.ctx, connection.id))?.watchChannelId).toEqual(
      expect.any(String),
    );

    await disconnect(orgA.member.ctx, connection.id);

    expect(await tablesHolding(connection.id)).toEqual([]);
  });
});

describe("the fake Drive's changes.watch", () => {
  it("refuses an account without a Drive scope, as Google does", async () => {
    const { orgA } = await seedTwoOrgs();
    const gmail = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      scopes: [GOOGLE_APP_SCOPES.gmail],
    });
    const body = { id: "a-channel", type: "web_hook", address: ADDRESS };

    const watching = proxyPost(
      orgA.member.ctx,
      gmail.id,
      "/drive/v3/changes/watch?pageToken=1",
      body,
      z.unknown(),
    );

    await expect(watching).rejects.toThrow(SourceRequestError);
    await expect(watching).rejects.toMatchObject({ status: 403 });
    expect(gmail.drive.channels.opened).toEqual([]);
  });
});
