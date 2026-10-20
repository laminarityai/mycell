// The Gmail connector. Polling from the history ID (`history.list`) arrives with #15.
import type { BackfillConnector, NormalizedEvent, SourceClient } from "../connector";
import { messageListSchema, messageSchema, profileSchema } from "./api";
import { normalizeMessage } from "./normalize";

// Messages per backfill page, so one page (one Inngest step) stays well inside a serverless
// request: each needs its own messages.get. Gmail allows up to 500.
const PAGE_SIZE = 100;
// messages.get calls in flight at once. Each costs 5 of Gmail's 250 quota units per user per
// second; Nango retries the 429s that bursts beyond that cause.
const FETCH_CONCURRENCY = 10;

export const gmailConnector: BackfillConnector = {
  async readStartCursor(client) {
    const profile = await client.get("/gmail/v1/users/me/profile", profileSchema);
    if (profile === null) throw new Error("Gmail has no profile for this mailbox");
    return profile.historyId;
  },

  async backfillPage(client, since, pageToken) {
    const query = new URLSearchParams({
      q: `after:${String(Math.floor(since.getTime() / 1000))}`,
      maxResults: String(PAGE_SIZE),
    });
    if (pageToken !== null) query.set("pageToken", pageToken);
    const list = await client.get(
      `/gmail/v1/users/me/messages?${query.toString()}`,
      messageListSchema,
    );
    const ids = (list?.messages ?? []).map((message) => message.id);
    const events = await mapConcurrently(ids, FETCH_CONCURRENCY, (id) => fetchEvent(client, id));
    return {
      // Search matches on Gmail's index; the window holds on each message's own internalDate.
      events: events.filter(
        (event): event is NormalizedEvent => event !== null && event.occurredAt >= since,
      ),
      nextPageToken: list?.nextPageToken ?? null,
    };
  },
};

// One message, fetched in full and normalized in memory. Null if it was deleted since listing.
async function fetchEvent(client: SourceClient, id: string): Promise<NormalizedEvent | null> {
  const message = await client.get(
    `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
    messageSchema,
  );
  return message === null ? null : normalizeMessage(message);
}

async function mapConcurrently<T, R>(
  items: T[],
  limit: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
