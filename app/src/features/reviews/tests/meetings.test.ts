// Meetings on the Reviews page (ADR-0013): a booked event waits on the person's calendar with no
// guests. Approving invites its guests exactly once, however often it's retried, and shows it as
// the step asked; declining deletes it. Guests added in Calendar end the review as done in the
// app, and a deleted event ends it as gone.
import { beforeEach, describe, expect, it } from "vitest";
import { bookingRun, GUEST, MEETING_AGENDA, MEETING_TITLE } from "@/db/testing/bookings";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { ConflictError, ValidationError } from "@/lib/errors";
import {
  approveEditedReview,
  approveReview,
  checkWaitingReviews,
  declineReview,
  listReviews,
  openReview,
} from "../server";

beforeEach(resetDatabase);

async function booked(book: Record<string, unknown> = {}) {
  const run = await bookingRun(await seedTwoOrgs(), { book });
  const { reviewId } = run;
  if (reviewId === undefined) throw new Error("no review");
  const event = run.calendar.organized().at(0);
  if (event === undefined) throw new Error("no event");
  return { ...run, reviewId, eventId: event.id };
}

const patches = <W extends { call: string }>(log: W[]) =>
  log.filter((write) => write.call === "patch");

describe("approving a meeting", () => {
  it("invites its guests and makes it visible and blocking time, by default", async () => {
    const { owner, calendar, reviewId, eventId } = await booked();

    await approveReview(owner, reviewId);

    expect(calendar.event(eventId)).toMatchObject({
      visibility: "default",
      transparency: "opaque",
      attendees: [{ email: GUEST, responseStatus: "needsAction" }],
    });
    expect(patches(calendar.writes.log)).toEqual([
      {
        call: "patch",
        eventId,
        sendUpdates: "all",
        notified: [GUEST],
        conferenceDataVersion: null,
      },
    ]);
    expect((await openReview(owner, reviewId)).review).toMatchObject({ status: "approved" });
  });

  it("shows it as the step asked once approved", async () => {
    const { owner, calendar, reviewId, eventId } = await booked({
      visibility: "public",
      transparency: "transparent",
    });

    await approveReview(owner, reviewId);

    expect(calendar.event(eventId)).toMatchObject({
      visibility: "public",
      transparency: "transparent",
    });
  });

  it("invites the guests exactly once when the first approval's answer was lost", async () => {
    const { owner, calendar, reviewId, eventId } = await booked();
    calendar.writes.loseNextAnswer();

    // Calendar made the change, but its answer never came: the review waits again.
    await expect(approveReview(owner, reviewId)).rejects.toThrow();
    expect((await listReviews(owner)).map((review) => review.id)).toEqual([reviewId]);
    await approveReview(owner, reviewId);

    expect(calendar.event(eventId).attendees).toEqual([
      { email: GUEST, responseStatus: "needsAction" },
    ]);
    const invitations = patches(calendar.writes.log).flatMap((write) => write.notified);
    expect(invitations).toEqual([GUEST]);
    expect((await openReview(owner, reviewId)).review).toMatchObject({ status: "approved" });
  });

  it("takes no edits: a meeting is changed in Calendar", async () => {
    const { owner, calendar, reviewId } = await booked();

    await expect(approveEditedReview(owner, reviewId, { text: "Other" })).rejects.toThrow(
      ValidationError,
    );
    expect(patches(calendar.writes.log)).toEqual([]);
  });

  it("keeps the title and description out of every table, approved or not", async () => {
    const { owner, reviewId } = await booked();
    await openReview(owner, reviewId);
    await approveReview(owner, reviewId);

    for (const content of [MEETING_TITLE, MEETING_AGENDA]) {
      expect(await tablesHolding(content)).toEqual([]);
    }
  });
});

describe("declining a meeting", () => {
  it("deletes the event, telling nobody", async () => {
    const { owner, calendar, reviewId, eventId } = await booked();

    await declineReview(owner, reviewId);

    expect(calendar.event(eventId).status).toBe("cancelled");
    expect(calendar.organized()).toEqual([]);
    expect(calendar.writes.log.at(-1)).toMatchObject({
      call: "delete",
      eventId,
      sendUpdates: "none",
      notified: [],
    });
    expect((await openReview(owner, reviewId)).review).toMatchObject({ status: "declined" });
  });
});

describe("a meeting finished or deleted in Calendar", () => {
  it("ends as done in the app once the person invites the guests there", async () => {
    const { owner, calendar, reviewId, eventId } = await booked();
    calendar.addGuests(eventId, [GUEST]);

    const opened = await openReview(owner, reviewId);

    expect(opened.view).toBeNull();
    expect(opened.review).toMatchObject({ status: "done_in_app", endedByUserId: null });
  });

  it("ends as gone once the person deletes the event, and approving it says so", async () => {
    const { owner, calendar, reviewId, eventId } = await booked();
    calendar.delete(eventId);

    await expect(approveReview(owner, reviewId)).rejects.toThrow(ConflictError);
    expect((await openReview(owner, reviewId)).review).toMatchObject({ status: "gone" });
    expect(patches(calendar.writes.log)).toEqual([]);
  });

  it("is ended by the daily check, which invites nobody", async () => {
    const first = await booked();
    first.calendar.addGuests(first.eventId, [GUEST]);

    await checkWaitingReviews(first.system);

    expect(await listReviews(first.owner)).toEqual([]);
    expect((await openReview(first.owner, first.reviewId)).review).toMatchObject({
      status: "done_in_app",
    });
    expect(patches(first.calendar.writes.log)).toEqual([]);
  });

  it("waits while the event has no guests", async () => {
    const { owner, system, reviewId } = await booked();

    await checkWaitingReviews(system);

    expect((await listReviews(owner)).map((review) => review.id)).toEqual([reviewId]);
  });
});
