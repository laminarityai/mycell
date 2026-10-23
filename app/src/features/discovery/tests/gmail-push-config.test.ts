// Gmail push is optional per environment (ADR-0026): without its settings the route isn't there,
// and every app keeps its minute poll. Bursts of notifications merge into one poll.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { env } from "@/env";
import { connectMailbox } from "@/testing/connect-helpers";
import { fakeGooglePush } from "@/testing/fake-google-push";
import { fakeInngest } from "@/testing/fake-inngest";
import { pollJob } from "../jobs";
import { backfillConnection } from "../server";

beforeEach(resetDatabase);

const PUSH_KEYS = [
  "GMAIL_PUSH_TOPIC",
  "GOOGLE_PUSH_AUDIENCE",
  "GOOGLE_PUSH_SERVICE_ACCOUNT",
] as const;

describe("the Gmail push route without push configured", () => {
  it("is 404, verified or not, and starts nothing", async () => {
    const { orgA } = await seedTwoOrgs();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email);
    await backfillConnection(orgA.member.ctx, connection.id);
    const verified = `Bearer ${await fakeGooglePush.token()}`;
    const body = fakeGooglePush.body(orgA.member.email);
    // The env is parsed once at startup; this test stands in for a deployment without push.
    const saved = PUSH_KEYS.map((key) => [key, env[key]] as const);
    for (const key of PUSH_KEYS) env[key] = undefined;
    try {
      expect((await fakeGooglePush.post(body, verified)).status).toBe(404);
      expect((await fakeGooglePush.post(body)).status).toBe(404);
    } finally {
      for (const [key, value] of saved) env[key] = value;
    }

    expect(fakeInngest.sent("discovery/connection.poll-due")).toEqual([]);
  });
});

describe("the poll job", () => {
  it("merges a burst for one connection into one poll, and still polls a steady stream", () => {
    expect(pollJob.opts.debounce).toEqual({
      key: "event.data.connectionId",
      period: "5s",
      timeout: "30s",
    });
  });

  it("keeps one ingest run per connection and a few per org", () => {
    expect(pollJob.opts.concurrency).toEqual([
      { scope: "env", key: '"ingest-connection-" + event.data.connectionId', limit: 1 },
      { scope: "env", key: '"ingest-org-" + event.data.orgId', limit: 3 },
    ]);
  });
});
