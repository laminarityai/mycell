// What the review-counts tests share: reviews seeded on a person's own mailbox and ended the
// way that person would end them, through the real acting paths and the fake Gmail.
import { randomUUID } from "node:crypto";
import type { FixtureUser } from "@/db/testing/two-org-fixture";
import type { Ctx } from "@/lib/ctx";
import type { connectMailbox } from "@/testing/connect-helpers";
import {
  approveEditedReview,
  approveReview,
  createReview,
  declineReview,
  listReviews,
  openReview,
} from "../server";
import type { ReviewStatus } from "../types";
import { pricingQuestion, REPLY, SUBJECT } from "./review-helpers";

type Mailbox = Awaited<ReturnType<typeof connectMailbox>>;
type Published = { workflowId: string; versionId: string };

/**
 * Seeds a question and a draft reply in `person`'s mailbox, records the review a run of
 * `workflow` would, and ends it as `ending` says: through Mycel (approved, edited, declined),
 * in Gmail (the draft sent, `done_in_app`, or deleted, `gone`), or not at all (`waiting`).
 * Returns the review's ID.
 */
export async function reviewEnded(
  person: FixtureUser,
  google: Mailbox,
  system: Ctx,
  workflow: Published,
  ending: ReviewStatus,
): Promise<string> {
  const message = google.mailbox.add(pricingQuestion({ at: new Date() }));
  const draft = google.mailbox.addDraft(message.threadId, {
    headers: { to: "Ada Lovelace <ada@customer.test>", subject: `Re: ${SUBJECT}` },
    text: REPLY,
  });
  if (draft === undefined) throw new Error("no draft");
  const before = new Set((await listReviews(person.ctx)).map((review) => review.id));
  await createReview(system, {
    runId: randomUUID(),
    connectionId: google.id,
    workflowId: workflow.workflowId,
    workflowVersionId: workflow.versionId,
    kind: "approval",
    itemRef: draft.id,
    threadRef: message.threadId,
    sourceRef: message.id,
  });
  const id = (await listReviews(person.ctx)).find((review) => !before.has(review.id))?.id;
  if (id === undefined) throw new Error("no new review");
  await end(person.ctx, id, ending, google, draft.id);
  return id;
}

async function end(ctx: Ctx, id: string, ending: ReviewStatus, google: Mailbox, draftId: string) {
  switch (ending) {
    case "waiting":
      return;
    case "approved":
      return approveReview(ctx, id);
    case "edited_approved":
      return approveEditedReview(ctx, id, { text: "Thanks Ada. 2,300 GBP, delivered." });
    case "declined":
      return declineReview(ctx, id);
    case "done_in_app":
      google.mailbox.sendDraft(draftId);
      await openReview(ctx, id);
      return;
    case "gone":
      google.mailbox.deleteDraft(draftId);
      await openReview(ctx, id);
      return;
  }
}

/** Every count zero, with `counts` over it. */
export function counts(
  counted: Partial<Record<ReviewStatus, number>> = {},
): Record<ReviewStatus, number> {
  return {
    waiting: 0,
    approved: 0,
    edited_approved: 0,
    declined: 0,
    done_in_app: 0,
    gone: 0,
    ...counted,
  };
}
