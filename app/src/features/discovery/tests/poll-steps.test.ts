// A poll's steps: one per page of Gmail's history or Drive's changes feed, and one per batch of
// the Gmail messages it reads, so a long listing never makes one long step, and a retry after a
// crash goes on from the last finished step instead of reading everything again.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { getConnection } from "@/features/connections/server";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle, daysAgo } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { fakeNango } from "@/testing/fake-nango";
import { recordingStepRunner } from "@/testing/recording-step-runner";
import { backfillConnection, pollConnection } from "../server";

beforeEach(resetDatabase);

const CUSTOMER = "alice@customer.example";
// Gmail's history pages hold 500 records, and a poll reads the messages they add 100 at a time.
const HISTORY_PAGE = 500;
// Drive's changes pages hold 1000 changes.
const CHANGES_PAGE = 1000;

// A member's Google account with a message and a file, backfilled, so both apps are active.
async function backfilledAccount() {
  const { orgA } = await seedTwoOrgs();
  const me = orgA.member.email;
  const connection = await connectGoogle(orgA.member.ctx, me, {
    messages: [{ from: CUSTOMER, to: [me], text: "Hello", at: daysAgo(2) }],
    files: [{ name: "Pricing", mimeType: "application/pdf", at: daysAgo(2) }],
  });
  await backfillConnection(orgA.member.ctx, connection.id);
  const poll = (runner: ReturnType<typeof recordingStepRunner>) =>
    pollConnection(systemCtx(orgA.id), connection.id, runner.runStep);
  return { orgA, me, connection, poll };
}

// Counts the proxied requests whose path starts with each prefix.
function countRequests(...prefixes: string[]) {
  const counts = new Map(prefixes.map((prefix) => [prefix, 0]));
  fakeNango.beforeProxy((path) => {
    for (const prefix of prefixes) {
      if (path.startsWith(prefix)) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  });
  return (prefix: string) => counts.get(prefix) ?? 0;
}

const HISTORY = "/gmail/v1/users/me/history";
const MESSAGES = "/gmail/v1/users/me/messages/";
const CHANGES = "/drive/v3/changes";

describe("polling a long Gmail history", () => {
  async function longHistory() {
    const account = await backfilledAccount();
    for (let n = 0; n <= HISTORY_PAGE; n++) {
      account.connection.mailbox.add({
        from: CUSTOMER,
        to: [account.me],
        text: "Hi",
        at: new Date(),
      });
    }
    return account;
  }

  it("takes one step per history page and one per 100 messages it reads", async () => {
    const { orgA, connection, poll } = await longHistory();
    const runner = recordingStepRunner();

    expect(await poll(runner)).toEqual({ outcome: "polled", items: HISTORY_PAGE + 1 });

    const fetches = [1, 2, 3, 4, 5, 6].flatMap((n) => [
      `gmail-poll-fetch-${String(n)}`,
      `gmail-poll-fetch-${String(n)}-announce`,
    ]);
    expect(runner.ids.filter((id) => id.startsWith("gmail-"))).toEqual([
      "gmail-poll-page-1",
      "gmail-poll-page-2",
      ...fetches,
      "gmail-poll-finish",
    ]);
    expect(await getConnection(orgA.member.ctx, connection.id)).toMatchObject({
      ingest: { gmail: { cursor: connection.mailbox.profile().historyId } },
    });
  });

  it("hands on message IDs from its pages and batches, never what a message says", async () => {
    const { poll } = await longHistory();
    const runner = recordingStepRunner();

    await poll(runner);

    const state = JSON.stringify(runner.results());
    expect(state).not.toContain("Hi");
    expect(state).not.toContain(CUSTOMER);
  });

  it("goes on after a crash from the last finished step, reading no page or message again", async () => {
    const { poll } = await longHistory();
    const runner = recordingStepRunner();
    runner.crashAt("gmail-poll-fetch-4");
    const requests = countRequests(HISTORY, MESSAGES);

    await expect(poll(runner)).rejects.toThrow("crashed before gmail-poll-fetch-4");
    expect(requests(HISTORY)).toBe(2);
    expect(requests(MESSAGES)).toBe(300);

    expect(await poll(runner)).toEqual({ outcome: "polled", items: HISTORY_PAGE + 1 });

    expect(requests(HISTORY)).toBe(2);
    expect(requests(MESSAGES)).toBe(HISTORY_PAGE + 1);
  });
});

describe("polling a long Drive changes feed", () => {
  async function longFeed() {
    const account = await backfilledAccount();
    for (let n = 0; n <= CHANGES_PAGE; n++) {
      account.connection.drive.add({
        name: `Order ${String(n)}`,
        mimeType: "application/pdf",
        at: new Date(),
      });
    }
    return account;
  }

  it("takes one step per changes page", async () => {
    const { orgA, connection, poll } = await longFeed();
    const runner = recordingStepRunner();

    expect(await poll(runner)).toEqual({ outcome: "polled", items: CHANGES_PAGE + 1 });

    expect(runner.ids.filter((id) => id.startsWith("drive-"))).toEqual([
      "drive-poll-page-1",
      "drive-poll-page-2",
      "drive-poll-finish",
      "drive-poll-announce",
    ]);
    expect(await getConnection(orgA.member.ctx, connection.id)).toMatchObject({
      ingest: { drive: { cursor: connection.drive.startPageToken().startPageToken } },
    });
  });

  it("goes on after a crash from the last finished page, reading none again", async () => {
    const { poll } = await longFeed();
    const runner = recordingStepRunner();
    runner.crashAt("drive-poll-page-2");
    const requests = countRequests(CHANGES);

    await expect(poll(runner)).rejects.toThrow("crashed before drive-poll-page-2");
    expect(requests(CHANGES)).toBe(1);

    expect(await poll(runner)).toEqual({ outcome: "polled", items: CHANGES_PAGE + 1 });

    expect(requests(CHANGES)).toBe(2);
  });

  it("announces what its first page stored when the second finds the token expired", async () => {
    const { connection, poll } = await longFeed();
    let pages = 0;
    fakeNango.beforeProxy((path) => {
      if (path !== CHANGES) return;
      pages += 1;
      if (pages === 2) connection.drive.expireTokens();
    });

    expect(await poll(recordingStepRunner())).toMatchObject({ outcome: "recovered" });

    // The first page's files are stored before the expiry, so the recovery finds them stored
    // already: they're announced as that page stored them, and the last as the recovery stored
    // it. With the backfill's file, every file is announced.
    const stored = fakeInngest
      .sent("discovery/item.stored")
      .filter((event) => event.data.app === "drive");
    const files = new Set(stored.map((event) => String(event.data.sourceRef).split("@")[0]));
    expect(files.size).toBe(CHANGES_PAGE + 2);
  });
});
