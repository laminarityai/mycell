// Drive's notification channels on a fake Drive, in the shapes Google documents
// (developers.google.com/workspace/drive/api/guides/push): changes.watch opens a web-hook
// channel on the account's changes feed from a page token, answering the channel with its
// resource ID and expiry (at most a week out), and channels.stop closes one by its ID and
// resource ID. Any Drive scope may do either (the proxy checks that). The fake records every
// channel, and posts a notification to the route as Drive would: empty, with the channel's
// headers. A test can refuse the next watch and fail the next stop.
import { randomUUID } from "node:crypto";
import { HttpResponse } from "msw";
import { z } from "zod";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// The fields changes.watch takes in its body. Google refuses any other with 400.
const watchRequest = z.strictObject({
  id: z.string().min(1).max(64),
  type: z.literal("web_hook"),
  address: z.url(),
  token: z.string().max(256).optional(),
  // Milliseconds since the epoch; JSON's int64 may come as a number or a string.
  expiration: z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]).optional(),
  params: z.record(z.string(), z.string()).optional(),
  payload: z.boolean().optional(),
});

const stopRequest = z.strictObject({ id: z.string(), resourceId: z.string() });

/** A channel a fake Drive opened. */
export type FakeChannel = {
  id: string;
  resourceId: string;
  address: string;
  token: string | undefined;
  // Milliseconds since the epoch, as Drive answers it: a string.
  expiration: string;
  // The changes feed's page token it watches from.
  pageToken: string;
  stopped: boolean;
};

/** A notification's X-Goog-Resource-State: a channel opened, or the changes feed changed. */
export type ResourceState = "sync" | "change" | "changed";

export class FakeDriveChannels {
  /** Every channel opened, in order, stopped ones included (refused ones aren't). */
  readonly opened: FakeChannel[] = [];
  // Drive's resource ID for the account's changes feed: the same for each channel on it.
  private readonly resourceId = `res-${randomUUID().slice(0, 12)}`;
  private refusals = 0;
  private stopFailures = 0;
  private messages = new Map<string, number>();

  /** The channels open now. */
  live(): FakeChannel[] {
    return this.opened.filter((channel) => !channel.stopped);
  }

  /** The latest channel opened. */
  latest(): FakeChannel {
    const channel = this.opened.at(-1);
    if (channel === undefined) throw new Error("The fake Drive opened no channel");
    return channel;
  }

  /** The next changes.watch is refused with 403, as for an account Drive won't watch. */
  refuseNextWatch(): void {
    this.refusals += 1;
  }

  /** The next channels.stop fails with 500, as Drive's backend errors do. */
  failNextStop(): void {
    this.stopFailures += 1;
  }

  /**
   * changes.watch, given the page token it names, whether Drive accepts that token, and the
   * request's JSON body.
   */
  watch(pageToken: string | null, tokenAccepted: boolean, body: unknown): Response {
    const request = watchRequest.safeParse(body);
    if (pageToken === null || !tokenAccepted) return driveError(400, "invalid", "pageToken");
    if (!request.success) return driveError(400, "invalid", "body");
    const { id, address, token, expiration } = request.data;
    if (this.opened.some((channel) => channel.id === id)) {
      return driveError(400, "channelIdNotUnique", "id");
    }
    const now = Date.now();
    if (expiration !== undefined && expiration > now + WEEK_MS) {
      return driveError(400, "invalid", "expiration");
    }
    if (this.refusals > 0) {
      this.refusals -= 1;
      return driveError(403, "forbidden", "id");
    }
    // Without an expiration, a changes channel lasts an hour.
    const expires = String(expiration ?? now + 60 * 60 * 1000);
    const channel: FakeChannel = {
      id,
      resourceId: this.resourceId,
      address,
      token,
      expiration: expires,
      pageToken,
      stopped: false,
    };
    this.opened.push(channel);
    return HttpResponse.json({
      kind: "api#channel",
      id,
      resourceId: channel.resourceId,
      resourceUri: `https://www.googleapis.com/drive/v3/changes?alt=json&pageToken=${pageToken}`,
      ...(token === undefined ? {} : { token }),
      expiration: expires,
    });
  }

  /** channels.stop: 204, or 404 for a channel Drive doesn't have open. */
  stop(body: unknown): Response {
    const request = stopRequest.safeParse(body);
    if (!request.success) return driveError(400, "required", "id");
    if (this.stopFailures > 0) {
      this.stopFailures -= 1;
      return driveError(500, "backendError", "id");
    }
    const channel = this.live().find(
      (open) => open.id === request.data.id && open.resourceId === request.data.resourceId,
    );
    if (channel === undefined) return driveError(404, "notFound", "id");
    channel.stopped = true;
    return new HttpResponse(null, { status: 204 });
  }

  /**
   * Posts a notification for `channel` to the route, as Drive does: an empty body, and headers
   * naming the channel, its token and the resource's state. `sync` is the message Drive sends
   * when a channel opens; the changes feed's other notifications are `change`.
   */
  async notify(channel: FakeChannel, state: ResourceState = "change"): Promise<Response> {
    const number = state === "sync" ? 1 : (this.messages.get(channel.id) ?? 1) + 1;
    this.messages.set(channel.id, number);
    const headers = new Headers({
      "Content-Length": "0",
      "X-Goog-Channel-ID": channel.id,
      "X-Goog-Channel-Expiration": new Date(Number(channel.expiration)).toUTCString(),
      "X-Goog-Resource-ID": channel.resourceId,
      "X-Goog-Resource-URI": "https://www.googleapis.com/drive/v3/changes",
      "X-Goog-Resource-State": state,
      "X-Goog-Message-Number": String(number),
    });
    if (channel.token !== undefined) headers.set("X-Goog-Channel-Token", channel.token);
    return postToRoute(channel.address, headers);
  }
}

/**
 * Posts an empty notification with `headers` to the Drive push route, as a forger (or Drive)
 * might, and returns the route's answer.
 */
export async function postToRoute(address: string, headers: Headers): Promise<Response> {
  // Loaded here rather than at the top, so the fake Drive doesn't load the whole app.
  const { POST } = await import("@/app/api/google/drive-push/route");
  return POST(new Request(address, { method: "POST", headers, body: "" }));
}

// An error as Drive returns it.
function driveError(code: 400 | 403 | 404 | 500, reason: string, location: string) {
  const message = {
    400: "Invalid Value",
    403: "Forbidden",
    404: "Not Found",
    500: "Backend Error",
  };
  const detail = { domain: "global", reason, message: message[code], location };
  return HttpResponse.json(
    { error: { code, message: message[code], errors: [detail] } },
    { status: code },
  );
}
