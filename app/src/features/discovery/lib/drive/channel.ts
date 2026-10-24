// Drive's watch (ADR-0026): a web-hook channel on the account's changes feed, opened with
// changes.watch from Drive's cursor, which posts to Mycel's Drive push route whenever the feed
// changes. Its token names the org and connection, signed with DRIVE_PUSH_SECRET, so the route
// finds the connection without a lookup and knows the channel is ours. A channel lasts at most a
// week; renewing opens a new one, and the old one is stopped after.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { InvariantError } from "@/lib/errors";
import { now } from "@/lib/time";
import type { Watcher } from "../connector";
import { drivePushConfig } from "../push-config";
import { channelSchema } from "./api";

// Drive's longest channel on the changes feed: 604800 seconds.
const CHANNEL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export const driveWatcher: Watcher = {
  configured: () => drivePushConfig() !== null,

  async start(client, { orgId, connectionId, cursor }) {
    const push = drivePushConfig();
    if (push === null) throw new InvariantError("Drive push isn't configured");
    if (cursor === null) throw new InvariantError("Drive has no cursor to watch from");
    const body = {
      id: randomUUID(),
      type: "web_hook",
      address: push.address,
      token: channelToken(push.secret, { orgId, connectionId }),
      expiration: now().getTime() + CHANNEL_LIFETIME_MS,
    };
    const query = new URLSearchParams({ pageToken: cursor });
    const path = `/drive/v3/changes/watch?${query.toString()}`;
    const channel = await client.post(path, body, channelSchema);
    if (channel === null) throw new InvariantError("Drive has no changes feed to watch");
    return {
      expiresAt: new Date(Number(channel.expiration)),
      channel: { id: channel.id, resourceId: channel.resourceId },
    };
  },

  // Drive answers 204, or 404 for a channel already gone, which is as good.
  async stop(client, channel) {
    await client.post("/drive/v3/channels/stop", channel, z.unknown());
  },
};

/** The org and connection a channel's token names. */
export type ChannelOwner = { orgId: string; connectionId: string };

/** A channel's token: `<orgId>.<connectionId>.<HMAC-SHA256 of the two, base64url>`. */
export function channelToken(secret: string, { orgId, connectionId }: ChannelOwner): string {
  return `${orgId}.${connectionId}.${mac(secret, orgId, connectionId)}`;
}

/**
 * The org and connection `token` names, if `secret` signed it; null for anything else. The
 * signature is compared in constant time.
 */
export function readChannelToken(secret: string, token: string | null): ChannelOwner | null {
  const parts = (token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [orgId = "", connectionId = "", given = ""] = parts;
  if (orgId === "" || connectionId === "") return null;
  const expected = Buffer.from(mac(secret, orgId, connectionId), "utf8");
  const offered = Buffer.from(given, "utf8");
  if (offered.length !== expected.length || !timingSafeEqual(offered, expected)) return null;
  return { orgId, connectionId };
}

function mac(secret: string, orgId: string, connectionId: string): string {
  return createHmac("sha256", secret).update(`${orgId}.${connectionId}`).digest("base64url");
}
