// Try it for a workflow that starts on a new invite (M11, #70): the picker offers recent
// invites, and the dry run reads the one picked, storing nothing.
import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { GOOGLE_APP_SCOPES } from "@/features/connections/types";
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { ValidationError } from "@/lib/errors";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { dryRun, recentInvites } from "../server";
import { inviteSpec } from "./calendar-helpers";

beforeEach(resetDatabase);

const MINUTE = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE);

const withClassify = () => ({
  ...inviteSpec(),
  steps: [
    {
      id: "sales",
      type: "classify",
      role: "classify",
      question: "Is this a sales call?",
      labels: ["yes", "no"],
    },
    ...(inviteSpec().steps as unknown[]),
  ],
});

describe("the Try it picker for invites", () => {
  it("offers the invites others sent, newest first, from calendars granted Calendar", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin } = orgA;
    const google = await connectGoogle(admin.ctx, admin.email);
    const older = google.calendar.invite({ title: "Intro", organizer: "ada@x.test", at: ago(9) });
    const newer = google.calendar.invite({ title: "Demo", organizer: "bo@x.test", at: ago(2) });
    google.calendar.organize({ title: "Our sync", guests: ["ada@x.test"], at: ago(1) });
    const gone = google.calendar.invite({ title: "Gone", organizer: "ada@x.test", at: ago(1) });
    google.calendar.cancel(gone.id);
    const noCalendar = Object.values(GOOGLE_APP_SCOPES).filter(
      (scope) => scope !== GOOGLE_APP_SCOPES.calendar,
    );
    await connectGoogle(admin.ctx, "ops@org-a.test", { kind: "org", scopes: noCalendar });

    expect(await recentInvites(admin.ctx)).toEqual([
      {
        connectionId: google.id,
        accountEmail: admin.email,
        kind: "member",
        messages: [
          { sourceRef: newer.id, subject: "Demo", from: "bo@x.test", date: newer.start.dateTime },
          { sourceRef: older.id, subject: "Intro", from: "ada@x.test", date: older.start.dateTime },
        ],
        unavailable: false,
      },
    ]);
  });
});

describe("trying a Calendar-triggered spec", () => {
  it("runs its steps on the invite, reading it live and storing nothing", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin } = orgA;
    const google = await connectGoogle(admin.ctx, admin.email);
    await grantCredits(systemCtx(orgA.id), 100);
    const invite = google.calendar.invite({
      title: "Renewal for Zanzibar Freight",
      organizer: "ada@customer.test",
    });
    fakeAiGateway.decision(
      { choice: "yes", probabilities: { yes: 0.9, no: 0.1 } },
      { costUsd: 0.0001 },
    );

    const result = await dryRun(admin.ctx, withClassify(), {
      connectionId: google.id,
      sourceRef: invite.id,
    });

    expect(result).toMatchObject({
      ended: "succeeded",
      steps: [
        { stepId: "sales", status: "succeeded", output: { label: "yes" } },
        { stepId: "route", status: "succeeded", output: { taken: ["customers"] } },
      ],
    });
    expect(JSON.stringify(fakeAiGateway.requests("decision")[0]?.body)).toContain("Zanzibar");
    expect(await tablesHolding("Zanzibar")).toEqual([]);
  });

  it("refuses a connection that wasn't granted Calendar, naming it", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin } = orgA;
    await connectGoogle(admin.ctx, admin.email);
    const noCalendar = Object.values(GOOGLE_APP_SCOPES).filter(
      (scope) => scope !== GOOGLE_APP_SCOPES.calendar,
    );
    const ops = await connectGoogle(admin.ctx, "ops@org-a.test", {
      kind: "org",
      scopes: noCalendar,
    });
    await connectGoogle(admin.ctx, "support@org-a.test", { kind: "org" });

    await expect(
      dryRun(
        admin.ctx,
        { ...inviteSpec(), credentials: "org" },
        {
          connectionId: ops.id,
          sourceRef: "event-1",
        },
      ),
    ).rejects.toThrow(new ValidationError("ops@org-a.test wasn't granted Calendar."));
  });
});
