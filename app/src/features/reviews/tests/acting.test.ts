// Acting on a review: approving sends the draft in its thread, editing first sends the edited
// text, declining deletes it, and only the first action on a review does anything. Opening a
// review checks the draft first, and ends the review if the person finished it in Gmail.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { AlreadyHandledError } from "@/lib/errors";
import {
  approveEditedReview,
  approveReview,
  declineReview,
  listReviews,
  openReview,
} from "../server";
import { exampleRun, QUESTION, REPLY, SUBJECT } from "./review-helpers";

beforeEach(resetDatabase);

const EDITED = "Thanks Ada. 30 oak chairs are 2,400 GBP, and we can deliver to Leeds on Friday.";

/** The example run's one waiting review, and the admin's mailbox it waits in. */
async function waitingReview() {
  const run = await exampleRun();
  const review = (await listReviews(run.admin)).at(0);
  if (review === undefined) throw new Error("no review");
  return { ...run, mailbox: run.google.mailbox, reviewId: review.id };
}

describe("approving a review", () => {
  it("sends the draft once, in its thread, and ends the review approved by that user", async () => {
    const { orgs, admin, mailbox, message, reviewId } = await waitingReview();

    await approveReview(admin, reviewId);

    expect(mailbox.drafts()).toEqual([]);
    expect(mailbox.writes.sent).toMatchObject([
      { threadId: message.threadId, text: REPLY, headers: { subject: `Re: ${SUBJECT}` } },
    ]);
    expect(mailbox.writes.log.filter((write) => write === "drafts.send")).toHaveLength(1);
    expect(mailbox.writes.log).not.toContain("drafts.update");
    expect(await listReviews(admin)).toEqual([]);
    expect((await openReview(admin, reviewId)).review).toMatchObject({
      status: "approved",
      endedByUserId: orgs.orgA.admin.id,
      endedAt: expect.any(Date) as Date,
    });
  });

  it("sends the edited text when the draft was edited first, and ends the review edited_approved", async () => {
    const { admin, mailbox, message, reviewId } = await waitingReview();

    await approveEditedReview(admin, reviewId, { text: EDITED });

    expect(mailbox.drafts()).toEqual([]);
    expect(mailbox.writes.sent).toMatchObject([
      {
        threadId: message.threadId,
        text: EDITED,
        headers: { to: "Ada Lovelace <ada@customer.test>", subject: `Re: ${SUBJECT}` },
      },
    ]);
    expect((await openReview(admin, reviewId)).review.status).toBe("edited_approved");
  });
});

describe("declining a review", () => {
  it("deletes the draft, sends nothing, and ends the review declined", async () => {
    const { orgs, admin, mailbox, reviewId } = await waitingReview();

    await declineReview(admin, reviewId);

    expect(mailbox.drafts()).toEqual([]);
    expect(mailbox.writes.sent).toEqual([]);
    expect(await listReviews(admin)).toEqual([]);
    expect((await openReview(admin, reviewId)).review).toMatchObject({
      status: "declined",
      endedByUserId: orgs.orgA.admin.id,
    });
  });
});

describe("acting twice on one review", () => {
  it.each([
    ["approving", (ctx: Parameters<typeof approveReview>[0], id: string) => approveReview(ctx, id)],
    ["declining", (ctx: Parameters<typeof declineReview>[0], id: string) => declineReview(ctx, id)],
    [
      "approving an edit",
      (ctx: Parameters<typeof approveReview>[0], id: string) =>
        approveEditedReview(ctx, id, { text: EDITED }),
    ],
  ])("sends nothing after approving, and throws AlreadyHandledError on %s", async (_, second) => {
    const { admin, mailbox, reviewId } = await waitingReview();
    await approveReview(admin, reviewId);
    const writes = [...mailbox.writes.log];

    await expect(second(admin, reviewId)).rejects.toThrow(AlreadyHandledError);

    expect(mailbox.writes.log).toEqual(writes);
    expect(mailbox.writes.sent).toHaveLength(1);
    expect((await openReview(admin, reviewId)).review.status).toBe("approved");
  });
});

describe("opening a review", () => {
  it("shows the message and the draft, fetched live", async () => {
    const { admin, reviewId } = await waitingReview();

    const opened = await openReview(admin, reviewId);

    expect(opened.review).toMatchObject({ status: "waiting", workflowName: "Pricing replies" });
    expect(opened.view).toEqual({
      kind: "draft",
      message: expect.objectContaining({
        from: "Ada Lovelace <ada@customer.test>",
        subject: SUBJECT,
        text: QUESTION,
      }) as unknown,
      draft: expect.objectContaining({
        to: "Ada Lovelace <ada@customer.test>",
        subject: `Re: ${SUBJECT}`,
        text: REPLY,
      }) as unknown,
    });
  });

  it("ends the review gone when its draft was deleted in Gmail", async () => {
    const { admin, mailbox, reviewId } = await waitingReview();
    const draft = mailbox.drafts().at(0);
    mailbox.deleteDraft(draft?.id ?? "");

    const opened = await openReview(admin, reviewId);

    expect(opened).toMatchObject({ review: { status: "gone", endedByUserId: null }, view: null });
    expect(await listReviews(admin)).toEqual([]);
  });

  it("ends the review done in the app when its draft was sent from Gmail", async () => {
    const { admin, mailbox, reviewId } = await waitingReview();
    const draft = mailbox.drafts().at(0);
    mailbox.sendDraft(draft?.id ?? "");

    const opened = await openReview(admin, reviewId);

    expect(opened).toMatchObject({ review: { status: "done_in_app" }, view: null });
    expect(await listReviews(admin)).toEqual([]);
  });

  it("ends the review gone when its draft was deleted in Gmail before approving", async () => {
    const { admin, mailbox, reviewId } = await waitingReview();
    const draft = mailbox.drafts().at(0);
    mailbox.deleteDraft(draft?.id ?? "");

    await expect(approveReview(admin, reviewId)).rejects.toThrow("no longer waiting");

    expect(mailbox.writes.sent).toEqual([]);
    expect((await openReview(admin, reviewId)).review.status).toBe("gone");
  });
});
