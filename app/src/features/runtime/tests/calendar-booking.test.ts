// Booking a meeting (ADR-0013): a run books the event on the person's calendar with no guests,
// private and not blocking time, notifying nobody, and leaves one review that keeps the guests.
// The event's title and description never reach a run, step or review record (invariant 8).
import { beforeEach, describe, expect, it } from "vitest";
import {
  bookingRun,
  END,
  GUEST,
  MEETING_AGENDA,
  MEETING_TITLE,
  START,
} from "@/db/testing/bookings";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { listReviews, openReview } from "@/features/reviews/server";
import type { RunStep } from "@/lib/inngest";
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle } from "@/testing/connect-helpers";
import { dryRun, getRun } from "../server";
import { recordedBackoff, recordsOf } from "./run-helpers";

beforeEach(resetDatabase);

describe("a run that books a meeting", () => {
  it("leaves one event with no guests, private and not blocking time, and one review", async () => {
    const { owner, calendar, outcome, reviewId, runId } = await bookingRun(await seedTwoOrgs());

    expect(outcome).toEqual({ status: "succeeded" });
    const events = calendar.organized();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      summary: MEETING_TITLE,
      description: MEETING_AGENDA,
      start: { dateTime: START },
      end: { dateTime: END },
      visibility: "private",
      transparency: "transparent",
    });
    expect(events[0]?.attendees).toBeUndefined();
    expect(events[0]?.conferenceData).toBeUndefined();
    expect(calendar.writes.log).toEqual([
      {
        call: "insert",
        eventId: events[0]?.id,
        sendUpdates: "none",
        notified: [],
        conferenceDataVersion: null,
      },
    ]);
    if (reviewId === undefined) throw new Error("no review");
    const opened = await openReview(owner, reviewId);
    expect(opened.review).toMatchObject({ kind: "calendar_event", status: "waiting" });
    expect(opened.view).toMatchObject({
      kind: "event",
      title: MEETING_TITLE,
      description: MEETING_AGENDA,
      guests: [GUEST],
      visibility: "default",
      transparency: "opaque",
      meetLink: null,
    });
    expect((await getRun(owner, runId)).steps.map((step) => step.stepId)).toEqual([
      "meeting",
      "book",
      "book-approval",
    ]);
  });

  it("keeps the title and description out of every run, step and review record", async () => {
    const { owner, runId } = await bookingRun(await seedTwoOrgs());

    const records = recordsOf(await getRun(owner, runId));
    for (const content of [MEETING_TITLE, MEETING_AGENDA]) {
      expect(records).not.toContain(content);
      expect(await tablesHolding(content)).toEqual([]);
    }
  });

  it("adds a Meet link only when the step asks for one", async () => {
    const { calendar } = await bookingRun(await seedTwoOrgs(), { book: { meet: true } });

    const event = calendar.organized().at(0);
    expect(event?.hangoutLink).toMatch(/^https:\/\/meet\.google\.com\//);
    expect(event?.attendees).toBeUndefined();
    expect(calendar.writes.log).toMatchObject([
      { call: "insert", sendUpdates: "none", notified: [], conferenceDataVersion: "1" },
    ]);
  });

  it("books one event when the booking's answer is lost and the step tries again", async () => {
    const retry = recordedBackoff();
    const { owner, calendar, outcome } = await bookingRun(await seedTwoOrgs(), {
      sleep: retry.sleep,
      // The insert is made, but its answer lost: the step's retry finds the event (409).
      beforeRun: (fake) => {
        fake.writes.loseNextAnswer();
      },
    });

    expect(outcome).toEqual({ status: "succeeded" });
    expect(retry.waits).toHaveLength(1);
    expect(calendar.organized()).toHaveLength(1);
    expect(calendar.writes.log.map((write) => write.call)).toEqual(["insert"]);
    expect(await listReviews(owner)).toHaveLength(1);
  });

  it("books one event when the run is replayed after its approval step", async () => {
    const runStep: RunStep = async (id, run) => {
      if (id === "book-approval") await run();
      return run();
    };
    const { owner, calendar } = await bookingRun(await seedTwoOrgs(), { runStep });

    expect(calendar.organized()).toHaveLength(1);
    expect(await listReviews(owner)).toHaveLength(1);
  });
});

describe("trying a booking", () => {
  it("reports the meeting it would book on an invite, and books nothing", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin } = orgA;
    const google = await connectGoogle(admin.ctx, admin.email);
    await grantCredits(systemCtx(orgA.id), 100);
    const invite = google.calendar.invite({ title: "Renewal", organizer: GUEST });
    const spec = {
      specVersion: 2,
      id: "follow-ups",
      credentials: "member",
      trigger: { type: "calendar.invite_received" },
      autonomy: { rung: 3 },
      steps: [
        {
          id: "read",
          type: "tool",
          action: "google-calendar.read-event",
          input: { eventId: { from: "trigger.eventId" } },
        },
        {
          id: "book",
          type: "tool",
          action: "google-calendar.create-event",
          input: {
            title: "Follow-up",
            start: START,
            end: END,
            guests: [{ from: "read.organizer" }],
            meet: true,
          },
        },
      ],
    };

    const result = await dryRun(admin.ctx, spec, {
      connectionId: google.id,
      sourceRef: invite.id,
    });

    expect(result).toMatchObject({
      ended: "succeeded",
      steps: [
        { stepId: "read", status: "succeeded" },
        {
          stepId: "book",
          status: "succeeded",
          effect: {
            kind: "event",
            title: "Follow-up",
            start: START,
            end: END,
            guests: [GUEST],
            meet: true,
          },
        },
        { stepId: "book-approval", effect: { kind: "review", channel: "calendar_events" } },
      ],
    });
    expect(google.calendar.writes.log).toEqual([]);
    expect(await tablesHolding("Renewal")).toEqual([]);
  });
});
