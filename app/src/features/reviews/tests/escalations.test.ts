// A message the workflow wasn't sure about reaches a person as an escalation review: it shows
// the live message, why the step handed it over, and a link to it in Gmail. The person marks it
// done, or replies in Gmail, which ends it on its own.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { dryRun } from "@/features/runtime/server";
import type { RunStep } from "@/features/runtime/types";
import { AlreadyHandledError, NotFoundError, ValidationError } from "@/lib/errors";
import { connectMailbox } from "@/testing/connect-helpers";
import {
  approveEditedReview,
  approveReview,
  declineReview,
  listReviews,
  markDone,
  openReview,
} from "../server";
import {
  escalateSpec,
  gateSpec,
  NOT_SURE,
  REFUND_QUESTION,
  REFUND_SUBJECT,
  refundQuestion,
  waitingEscalation,
} from "./escalation-helpers";
import { exampleRun } from "./review-helpers";

beforeEach(resetDatabase);

/** Runs the gate's escalate step twice, as an Inngest retry would. */
const escalationRetried: RunStep = async (id, run) => {
  if (id === "gate-escalate") await run();
  return run();
};

describe("an escalation", () => {
  it("is one waiting review when a message is under the gate's floor, even when retried, and the run ends escalated", async () => {
    const { admin, message, workflowId, outcome } = await waitingEscalation({
      spec: gateSpec(),
      sure: 0.6,
      runStep: escalationRetried,
    });

    expect(outcome).toEqual({ status: "escalated" });
    const reviews = await listReviews(admin);
    expect(reviews).toEqual([
      {
        id: expect.any(String) as string,
        kind: "escalation",
        workflowId,
        workflowName: "Refund requests",
        sharedWith: null,
        handOff: null,
        createdAt: expect.any(Date) as Date,
      },
    ]);
    const opened = await openReview(admin, reviews.at(0)?.id ?? "");
    expect(opened.review).toMatchObject({
      status: "waiting",
      reason: "The message didn't meet the branch's condition.",
    });
    expect(opened.view).toMatchObject({
      kind: "message",
      message: { subject: REFUND_SUBJECT, text: REFUND_QUESTION },
      link: expect.stringContaining(message.threadId) as string,
    });
  });
});

describe("Try it", () => {
  it("never makes an escalation review", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    const google = await connectMailbox(admin, orgA.admin.email, [refundQuestion()]);
    const message = google.mailbox.list(new URLSearchParams()).messages?.at(0);

    const result = await dryRun(admin, escalateSpec(), {
      connectionId: google.id,
      sourceRef: message?.id ?? "",
    });

    expect(result.ended).toBe("escalated");
    expect(await listReviews(admin)).toEqual([]);
  });
});

describe("marking an escalation done", () => {
  it("ends it done_in_app by that user, says why the step handed it over, and changes nothing in Gmail", async () => {
    const { orgs, admin, mailbox, reviewId } = await waitingEscalation();
    expect((await openReview(admin, reviewId)).review.reason).toBe(NOT_SURE);

    await markDone(admin, reviewId);

    expect(await listReviews(admin)).toEqual([]);
    expect((await openReview(admin, reviewId)).review).toMatchObject({
      status: "done_in_app",
      endedByUserId: orgs.orgA.admin.id,
      endedAt: expect.any(Date) as Date,
    });
    expect(mailbox.writes.log).toEqual([]);
  });
});

describe("replying to an escalated message in Gmail", () => {
  it("ends the escalation done_in_app when it's opened, with no one named", async () => {
    const { orgs, admin, mailbox, message, reviewId } = await waitingEscalation();
    mailbox.add({
      from: orgs.orgA.admin.email,
      to: ["ada@customer.test"],
      subject: `Re: ${REFUND_SUBJECT}`,
      text: "Sorry about that, Ada. Two new chairs are on their way.",
      sent: true,
      at: new Date(),
      threadId: message.threadId,
    });

    const opened = await openReview(admin, reviewId);

    expect(opened.view).toBeNull();
    expect(opened.review).toMatchObject({ status: "done_in_app", endedByUserId: null });
    expect(await listReviews(admin)).toEqual([]);
  });

  it("leaves it waiting when the only sent message in the thread came before it", async () => {
    const { admin, reviewId } = await waitingEscalation({
      earlier: {
        from: "Oak & Co <sales@oak.test>",
        subject: "Your order",
        text: "Your chairs ship today.",
        sent: true,
        at: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    const opened = await openReview(admin, reviewId);

    expect(opened.review.status).toBe("waiting");
    expect(opened.view).toMatchObject({ kind: "message", message: { text: REFUND_QUESTION } });
  });
});

describe("acting on an escalation", () => {
  it("is the same as for approvals: its owner alone may, and only the first action counts", async () => {
    const { orgs, admin, reviewId } = await waitingEscalation();
    const member = orgs.orgA.member.ctx;

    await expect(openReview(member, reviewId)).rejects.toThrow(NotFoundError);
    await expect(markDone(member, reviewId)).rejects.toThrow(NotFoundError);
    await markDone(admin, reviewId);
    await expect(markDone(admin, reviewId)).rejects.toThrow(AlreadyHandledError);
  });

  it("offers only done: approving, editing or declining it is refused, and it keeps waiting", async () => {
    const { admin, mailbox, reviewId } = await waitingEscalation();

    await expect(approveReview(admin, reviewId)).rejects.toThrow(ValidationError);
    await expect(approveEditedReview(admin, reviewId, { text: "Hi" })).rejects.toThrow(
      ValidationError,
    );
    await expect(declineReview(admin, reviewId)).rejects.toThrow(ValidationError);

    expect((await openReview(admin, reviewId)).review.status).toBe("waiting");
    expect(mailbox.writes.log).toEqual([]);
  });

  it("is never offered for an approval: marking a draft's review done is refused", async () => {
    const { admin, google } = await exampleRun();
    const reviewId = (await listReviews(admin)).at(0)?.id ?? "";

    await expect(markDone(admin, reviewId)).rejects.toThrow(ValidationError);

    expect((await openReview(admin, reviewId)).review.status).toBe("waiting");
    expect(google.mailbox.drafts()).toHaveLength(1);
  });
});
