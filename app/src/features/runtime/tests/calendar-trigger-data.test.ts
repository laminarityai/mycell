// What the Calendar trigger keeps (M11, #70): the sync token alone, gone with its connection
// however the connection goes (invariant 3), and never an event's content (invariant 8). And the
// fake Calendar holds the poll to Google's sync token rules.
import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { disconnect, proxyGet, reconcileConnections } from "@/features/connections/server";
import { SourceRequestError } from "@/features/connections/types";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { enable } from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle, deliver } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeNango } from "@/testing/fake-nango";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import { z } from "zod";
import { calendarsDue, executeRun, getRun, pollCalendar, startInviteRuns } from "../server";
import { announced, calendarSwitchedOn, inviteSpec } from "./calendar-helpers";

beforeEach(resetDatabase);

// Polls twice, and returns the sync token the second poll stored.
async function storedToken() {
  const switched = await calendarSwitchedOn();
  const { system, google, calendar } = switched;
  await pollCalendar(system, google.id);
  await pollCalendar(system, google.id);
  const token = calendar.lastSyncToken;
  if (token === undefined) throw new Error("No sync token was handed out");
  expect(await tablesHolding(token)).toEqual(["trigger_cursors"]);
  return { ...switched, token };
}

describe("the sync token, when its connection goes", () => {
  it("is deleted when its owner disconnects", async () => {
    const { admin, google, token } = await storedToken();

    await disconnect(admin.ctx, google.id);

    expect(await tablesHolding(token)).toEqual([]);
  });

  it("is deleted when Nango's deletion webhook arrives", async () => {
    const { google, token } = await storedToken();

    await deliver(fakeNango.deleteOutsideMycel(google.nangoConnectionId));

    expect(await tablesHolding(token)).toEqual([]);
  });

  it("is deleted by the nightly reconciliation", async () => {
    const { google, token } = await storedToken();
    fakeNango.deleteWithoutWebhook(google.nangoConnectionId);

    await reconcileConnections();

    expect(await tablesHolding(token)).toEqual([]);
  });

  it("ends a poll quietly when the connection is deleted under it", async () => {
    const { admin, system, google, calendar } = await calendarSwitchedOn();
    await pollCalendar(system, google.id);
    calendar.invite({ title: "Intro", organizer: "ada@customer.test" });
    fakeNango.beforeProxy(() => disconnect(admin.ctx, google.id));

    expect(await pollCalendar(system, google.id)).toEqual({ outcome: "gone" });
    expect(announced()).toEqual([]);
  });
});

describe("what the Calendar trigger stores", () => {
  it("keeps no title or description, through the poll and the run it starts", async () => {
    const { system, admin, google, calendar } = await calendarSwitchedOn();
    await pollCalendar(system, google.id);
    calendar.invite({
      title: "Renewal for Zanzibar Freight",
      description: "Bring the quinquennial pricing sheet",
      organizer: "ada@customer.test",
    });
    await pollCalendar(system, google.id);
    const { runIds } = await startInviteRuns(system, announced()[0]);

    await executeRun(system, runIds[0]);

    // The branch read the invite's organizer, and took the customers' path.
    expect(await getRun(admin.ctx, runIds[0])).toMatchObject({
      status: "succeeded",
      steps: [{ stepId: "route", output: { taken: ["customers"] } }],
    });
    expect(await tablesHolding("Zanzibar")).toEqual([]);
    expect(await tablesHolding("quinquennial")).toEqual([]);
  });

  it("has a model step read the invite live, keeping only its answer", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin } = orgA;
    const google = await connectGoogle(admin.ctx, admin.email);
    await grantCredits(systemCtx(orgA.id), 100);
    await tagUsers(admin.ctx, "sales", [admin]);
    const { workflowId } = await publishTo(
      admin.ctx,
      "Sales calls",
      { ...inviteSpec(), steps: [CLASSIFY] },
      ["sales"],
    );
    await enable(admin.ctx, workflowId);
    const system = systemCtx(orgA.id);
    await pollCalendar(system, google.id);
    google.calendar.invite({
      title: "Renewal for Zanzibar Freight",
      description: "Bring the quinquennial pricing sheet",
      organizer: "ada@customer.test",
    });
    await pollCalendar(system, google.id);
    const { runIds } = await startInviteRuns(system, announced()[0]);
    fakeAiGateway.decision(
      { choice: "yes", probabilities: { yes: 0.9, no: 0.1 } },
      { costUsd: 0.0001 },
    );

    await executeRun(system, runIds[0]);

    expect(JSON.stringify(fakeAiGateway.requests("decision")[0]?.body)).toContain(
      "quinquennial pricing sheet",
    );
    expect(await getRun(admin.ctx, runIds[0])).toMatchObject({
      status: "succeeded",
      steps: [{ stepId: "sales", output: { label: "yes", p: 0.9 } }],
    });
    expect(await tablesHolding("quinquennial")).toEqual([]);
  });
});

const CLASSIFY = {
  id: "sales",
  type: "classify",
  role: "classify",
  question: "Is this a sales call?",
  labels: ["yes", "no"],
};

describe("which calendars the cron polls", () => {
  it("lists only connections a Calendar-triggered workflow is switched on for", async () => {
    const { orgA, google } = await calendarSwitchedOn();

    expect(await calendarsDue()).toEqual([{ orgId: orgA.id, connectionId: google.id }]);
  });
});

describe("the fake Calendar, holding the poll to Google's rules", () => {
  const page = z.object({ nextSyncToken: z.string() });

  it("refuses a sync token with a filter, or with parameters other than its own, and expires", async () => {
    const { admin, google, calendar } = await calendarSwitchedOn();
    const events = "/calendar/v3/calendars/primary/events";
    const first = await proxyGet(admin.ctx, google.id, `${events}?maxResults=10`, page);
    const token = first?.nextSyncToken ?? "";
    const list = (params: string) =>
      proxyGet(admin.ctx, google.id, `${events}?syncToken=${token}&${params}`, page);

    await expect(list("maxResults=10")).resolves.toMatchObject({
      nextSyncToken: expect.any(String) as string,
    });
    await expect(list("maxResults=20")).rejects.toThrow(SourceRequestError);
    await expect(list("maxResults=10&timeMin=2026-01-01T00:00:00Z")).rejects.toThrow(
      SourceRequestError,
    );
    calendar.expireSyncTokens();
    // Google's 410, which the proxy reads as "no such item".
    await expect(list("maxResults=10")).resolves.toBeNull();
  });
});
