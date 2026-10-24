// Booked meetings through the real paths, for any feature's tests (ADR-0013): a published
// workflow reads a meeting request in Gmail, extracts the meeting with a model, and books it on
// the person's calendar, where it waits with no guests for its review (`book-approval`, which the
// policy engine inserts).
import { grantCredits } from "@/features/credits/server";
import { listReviews } from "@/features/reviews/server";
import { executeRun, startRun } from "@/features/runtime/server";
import { getWorkflow, publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import type { RunSleep, RunStep } from "@/lib/inngest";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import type { FakeCalendar } from "@/testing/fake-calendar";
import type { TwoOrgs } from "./two-org-fixture";

/** Markers in the meeting's title and description, for scans of what Mycel stores. */
export const MEETING_TITLE = "Oak chairs walkthrough TITLE-4be1c7";
export const MEETING_AGENDA = "Prices and lead times for 30 chairs AGENDA-91d0aa";
export const GUEST = "ada@customer.test";
export const START = "2026-11-03T15:00:00.000Z";
export const END = "2026-11-03T15:30:00.000Z";

/**
 * Reads the meeting from the request, then books it, inviting the sender. `book` overrides the
 * booking step's input: how it shows once approved, and whether it gets a Meet link.
 */
export function bookingSpec(book: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    specVersion: 2,
    id: "book-calls",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    autonomy: { rung: 3 },
    steps: [
      {
        id: "meeting",
        type: "extract",
        role: "fast",
        fields: {
          title: { type: "string", description: "A short title for the call" },
          agenda: { type: "string", description: "What the call is about" },
          start: { type: "string", description: "When it starts, with its UTC offset" },
          end: { type: "string", description: "When it ends, with its UTC offset" },
          guest: { type: "string", description: "The sender's address" },
        },
      },
      {
        id: "book",
        type: "tool",
        action: "google-calendar.create-event",
        input: {
          title: { from: "meeting.title" },
          description: { from: "meeting.agenda" },
          start: { from: "meeting.start" },
          end: { from: "meeting.end" },
          guests: [{ from: "meeting.guest" }],
          ...book,
        },
      },
    ],
  };
}

export type BookingOptions = {
  /** The booking step's input overrides. */
  book?: Record<string, unknown>;
  runStep?: RunStep;
  /** How a retry waits: the recorded backoff, in tests that make a step retry. */
  sleep?: RunSleep;
  /** Runs on the calendar just before the run, to set it up (losing an answer, say). */
  beforeRun?: (calendar: FakeCalendar) => void;
};

/**
 * Org A's admin publishes the booking workflow and runs it on a meeting request in their own
 * Google account, which leaves one event waiting on their calendar and one review.
 */
export async function bookingRun(orgs: TwoOrgs, options: BookingOptions = {}) {
  const { orgA } = orgs;
  const owner = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const google = await connectGoogle(owner, orgA.admin.email);
  const message = google.mailbox.add({
    from: `Ada Lovelace <${GUEST}>`,
    subject: "A call about oak chairs?",
    text: "Could we talk on Tuesday at 3pm for half an hour?",
    at: new Date(Date.now() - 60 * 1000),
  });
  const { id: workflowId } = await saveWorkflow(owner, {
    name: "Book calls",
    spec: bookingSpec(options.book),
  });
  await publishWorkflow(owner, workflowId);
  if ((await getWorkflow(owner, workflowId)).versions.length === 0) throw new Error("unpublished");
  const { runId } = await startRun(owner, workflowId, google.id, message.id);
  fakeAiGateway.object({
    title: MEETING_TITLE,
    agenda: MEETING_AGENDA,
    start: START,
    end: END,
    guest: GUEST,
  });
  options.beforeRun?.(google.calendar);
  const outcome = await executeRun(system, runId, options.runStep, options.sleep);
  const reviewId = (await listReviews(owner)).at(0)?.id;
  return {
    owner,
    system,
    google,
    calendar: google.calendar,
    message,
    workflowId,
    runId,
    outcome,
    reviewId,
  };
}
