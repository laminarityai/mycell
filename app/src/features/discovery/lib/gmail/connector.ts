// The Gmail connector: the history ID as the cursor, messages.list for the backfill,
// history.list for polling, and users.watch for push (ADR-0026). Polling reads messages added,
// which it fetches and normalizes as the backfill does, and messages deleted for good or moved
// to the trash, which it reports removed. Deleting in Gmail's own app moves a message to the
// trash, where it stays 30 days before it's deleted for good, so a trashed message counts as
// removed: what Mycel learned from it goes at once.
import { GMAIL, messageListSchema, messageSchema } from "@/features/connections/gmail";
import { InvariantError } from "@/lib/errors";
import type { Connector, NormalizedEvent, SourceClient } from "../connector";
import { gmailPushConfig } from "../push-config";
import { historyListSchema, profileSchema, watchSchema } from "./api";
import { normalizeMessage } from "./normalize";

// Messages per backfill page, so one page (one Inngest step) stays well inside a serverless
// request: each needs its own messages.get. Gmail allows up to 500.
const PAGE_SIZE = 100;
// messages.get calls in flight at once. Each costs 5 of Gmail's 250 quota units per user per
// second; Nango retries the 429s that bursts beyond that cause.
const FETCH_CONCURRENCY = 10;
// History records per history.list page, Gmail's maximum.
const HISTORY_PAGE_SIZE = 500;
// The history polling reads: messages added, deleted for good, and given labels (the trash).
const HISTORY_TYPES = ["messageAdded", "messageDeleted", "labelAdded"];
// messages.list leaves spam and trash out unless asked (includeSpamTrash), so polling does too.
// Drafts are left out of both: each save replaces a draft's message with a new message ID (Gmail
// drafts guide), so every autosave would otherwise become another event. The watch leaves them
// out too, so a draft save doesn't notify.
const EXCLUDED_LABELS = ["DRAFT", "SPAM", "TRASH"];

export const gmailConnector: Connector = {
  async readStartCursor(client) {
    const profile = await client.get(`${GMAIL}/profile`, profileSchema);
    if (profile === null) throw new InvariantError("Gmail has no profile for this mailbox");
    return profile.historyId;
  },

  async backfillPage(client, since, pageToken) {
    const query = new URLSearchParams({
      q: `after:${String(Math.floor(since.getTime() / 1000))}`,
      maxResults: String(PAGE_SIZE),
    });
    if (pageToken !== null) query.set("pageToken", pageToken);
    const list = await client.get(`${GMAIL}/messages?${query.toString()}`, messageListSchema);
    const ids = (list?.messages ?? []).map((message) => message.id);
    const events = await mapConcurrently(ids, FETCH_CONCURRENCY, (id) => fetchEvent(client, id));
    return {
      // Search matches on Gmail's index; the window holds on each message's own internalDate.
      events: events.filter(
        (event): event is NormalizedEvent => isIngested(event) && event.occurredAt >= since,
      ),
      nextPageToken: list?.nextPageToken ?? null,
    };
  },

  async poll(client, cursor) {
    const added = new Set<string>();
    const removed = new Set<string>();
    let nextCursor: string | undefined;
    let pageToken: string | null = null;
    do {
      const query = new URLSearchParams({
        startHistoryId: cursor,
        maxResults: String(HISTORY_PAGE_SIZE),
      });
      for (const type of HISTORY_TYPES) query.append("historyTypes", type);
      if (pageToken !== null) query.set("pageToken", pageToken);
      const page = await client.get(`${GMAIL}/history?${query.toString()}`, historyListSchema);
      // Gmail answers 404 for a history ID it no longer keeps (roughly a week).
      if (page === null) return { cursorExpired: true };
      // The first page's history ID: whatever arrives while later pages are read is after it,
      // so the next poll gets it (and a message seen twice is stored once).
      nextCursor ??= page.historyId;
      for (const record of page.history ?? []) {
        for (const { message } of record.messagesAdded ?? []) added.add(message.id);
        for (const { message } of record.messagesDeleted ?? []) removed.add(message.id);
        for (const { message, labelIds } of record.labelsAdded ?? []) {
          if (labelIds?.includes("TRASH") === true) removed.add(message.id);
        }
      }
      pageToken = page.nextPageToken ?? null;
    } while (pageToken !== null);
    const events = await mapConcurrently([...added], FETCH_CONCURRENCY, (id) =>
      fetchEvent(client, id),
    );
    return { events: events.filter(isIngested), removed: [...removed], nextCursor };
  },

  // Gmail publishes to GMAIL_PUSH_TOPIC whenever the mailbox changes, except for changes to a
  // message with an excluded label. Asking again renews the watch; Gmail's lasts 7 days.
  watch: {
    configured: () => gmailPushConfig() !== null,
    async start(client) {
      const push = gmailPushConfig();
      if (push === null) throw new InvariantError("Gmail push isn't configured");
      const body = {
        topicName: push.topic,
        labelFilterBehavior: "exclude",
        labelIds: EXCLUDED_LABELS,
      };
      const answer = await client.post(`${GMAIL}/watch`, body, watchSchema);
      if (answer === null) throw new InvariantError("Gmail has no mailbox to watch");
      return { expiresAt: new Date(Number(answer.expiration)), channel: null };
    },
  },
};

// A message that still exists, and isn't spam, trash or a draft.
function isIngested(event: NormalizedEvent | null): event is NormalizedEvent {
  return event !== null && !event.labelIds.some((label) => EXCLUDED_LABELS.includes(label));
}

// One message, fetched in full and normalized in memory. Null if it was deleted since listing.
async function fetchEvent(client: SourceClient, id: string): Promise<NormalizedEvent | null> {
  const message = await client.get(
    `${GMAIL}/messages/${encodeURIComponent(id)}?format=full`,
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
