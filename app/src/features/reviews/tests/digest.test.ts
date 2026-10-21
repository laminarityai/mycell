// The daily digest: as each org's system ctx, it ends the reviews whose item is done or gone,
// then emails everyone with a review waiting and the digest on: the count, then each workflow's
// count and oldest age, oldest first, and a link to the Reviews page. Never message or draft
// text.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser, type TwoOrgs } from "@/db/testing/two-org-fixture";
import { setReviewDigest, unsubscribeWithLink } from "@/features/notifications/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { connectMailbox } from "@/testing/connect-helpers";
import { fakeEmail } from "@/testing/fake-email";
import { approveReview, createReview, listReviews, openReview, sendReviewDigest } from "../server";
import {
  memberReview,
  orgReview,
  pricingQuestion,
  publish,
  replySpec,
  reviewOn,
} from "./review-helpers";

beforeEach(resetDatabase);

const DAY = 24 * 60 * 60 * 1000;

type Workflow = { workflowId: string; versionId: string };

/**
 * Org A's admin publishes two workflows, Pricing replies and Refund replies, and its member gets
 * a review of Pricing replies on their own mailbox (with `text` as its question and draft).
 */
async function twoWorkflows(orgs: TwoOrgs, text: { text?: string; draft?: string } = {}) {
  const { orgA } = orgs;
  await connectMailbox(orgA.admin.ctx, orgA.admin.email);
  const pricing = await publish(orgA.admin.ctx, replySpec(), "Pricing replies");
  const refunds = await publish(
    orgA.admin.ctx,
    { ...replySpec(), id: "refund-replies" },
    "Refund replies",
  );
  const seeded = await reviewOn(orgA.member.ctx, orgA.member.email, systemCtx(orgA.id), {
    ...pricing,
    ...text,
  });
  return { pricing, refunds, ...seeded };
}

/** Another review on the member's mailbox, for `workflow`: its own question and draft. */
async function anotherReview(
  orgs: TwoOrgs,
  seeded: Awaited<ReturnType<typeof twoWorkflows>>,
  workflow: Workflow,
  text = { question: "Do you deliver to York?", draft: "We do, in 3 days." },
) {
  const message = seeded.mailbox.add(pricingQuestion({ subject: "York", text: text.question }));
  const draft = seeded.mailbox.addDraft(message.threadId, {
    headers: { to: "Ada Lovelace <ada@customer.test>", subject: "Re: York" },
    text: text.draft,
  });
  if (draft === undefined) throw new Error("no draft");
  await createReview(systemCtx(orgs.orgA.id), {
    runId: randomUUID(),
    connectionId: seeded.google.id,
    workflowId: workflow.workflowId,
    workflowVersionId: workflow.versionId,
    kind: "approval",
    itemRef: draft.id,
    threadRef: message.threadId,
    sourceRef: message.id,
  });
}

function linkIn(text: string, path: string): string {
  const link = text.match(new RegExp(`https?://\\S+${path}\\S*`))?.[0];
  if (link === undefined) throw new Error(`no ${path} link in: ${text}`);
  return link;
}

describe("sendReviewDigest", () => {
  it("emails only the people with a review waiting", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    await memberReview(orgs);

    await sendReviewDigest(systemCtx(orgA.id));

    expect(fakeEmail.sent()).toEqual([
      expect.objectContaining({
        to: [orgA.member.email],
        subject: "1 review is waiting for you in Mycel",
      }),
    ]);
  });

  it("counts a shared review for everyone who sees it", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    await orgReview(orgs);
    await seedUser(orgA.id, "untagged@org-a.test", "member");

    await sendReviewDigest(systemCtx(orgA.id));

    expect(
      fakeEmail
        .sent()
        .map((email) => email.to[0])
        .sort(),
    ).toEqual([orgA.admin.email, orgA.member.email].sort());
    expect(fakeEmail.sent().at(0)?.text).toContain("Support replies: 1 waiting");
  });

  it("lists the count, then each workflow's count and oldest age, oldest first", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const seeded = await twoWorkflows(orgs);
    await anotherReview(orgs, seeded, seeded.refunds);
    await anotherReview(orgs, seeded, seeded.pricing);
    await anotherReview(orgs, seeded, seeded.refunds);

    await sendReviewDigest(systemCtx(orgA.id), { now: new Date(Date.now() + 2 * DAY) });

    const email = fakeEmail.sent(orgA.member.email).at(0);
    expect(email?.subject).toBe("4 reviews are waiting for you in Mycel");
    expect(email?.text).toContain(
      [
        "4 reviews are waiting for you in Mycel.",
        "",
        "Pricing replies: 2 waiting, the oldest for 2 days",
        "Refund replies: 2 waiting, the oldest for 2 days",
      ].join("\n"),
    );
    expect(linkIn(email?.text ?? "", "/reviews")).toBe("http://localhost:3000/reviews");
    expect(email?.html).toContain('href="http://localhost:3000/reviews"');
    const html = email?.html ?? "";
    expect(html.indexOf("Pricing replies")).toBeLessThan(html.indexOf("Refund replies"));
  });

  it("puts the workflow whose review waited longest first, whatever its name", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const seeded = await twoWorkflows(orgs);
    await anotherReview(orgs, seeded, seeded.refunds);
    await anotherReview(orgs, seeded, seeded.pricing);
    const first = (await listReviews(orgA.member.ctx)).at(0);
    await approveReview(orgA.member.ctx, first?.id ?? "");

    await sendReviewDigest(systemCtx(orgA.id));

    const text = fakeEmail.sent(orgA.member.email).at(0)?.text ?? "";
    expect(text).toContain("Refund replies: 1 waiting, for under an hour");
    expect(text.indexOf("Refund replies")).toBeLessThan(text.indexOf("Pricing replies"));
  });

  it("never carries message or draft text", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const seeded = await twoWorkflows(orgs, {
      text: "MARKER-QUESTION-7f3a",
      draft: "MARKER-DRAFT-7f3a",
    });
    await anotherReview(orgs, seeded, seeded.refunds, {
      question: "MARKER-QUESTION-9b1c",
      draft: "MARKER-DRAFT-9b1c",
    });

    await sendReviewDigest(systemCtx(orgA.id));

    const emails = fakeEmail.sent();
    expect(emails).toHaveLength(1);
    for (const email of emails) {
      const all = [email.subject, email.text, email.html, JSON.stringify(email.headers)].join();
      expect(all).not.toMatch(/MARKER|oak chairs|Leeds|York|2,400|Ada|customer\.test/);
    }
  });

  it("skips anyone who turned the digest off", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    await memberReview(orgs);
    await setReviewDigest(orgA.member.ctx, false);

    await sendReviewDigest(systemCtx(orgA.id));

    expect(fakeEmail.sent()).toEqual([]);
  });

  it("carries an unsubscribe link that turns the digest off for that person only", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const { pricing } = await twoWorkflows(orgs);
    const colleague = await seedUser(orgA.id, "colleague@org-a.test", "member");
    await reviewOn(colleague.ctx, colleague.email, systemCtx(orgA.id), pricing);
    await sendReviewDigest(systemCtx(orgA.id));
    const email = fakeEmail.sent(orgA.member.email).at(0);
    const link = linkIn(email?.text ?? "", "/unsubscribe");
    expect(email?.headers["List-Unsubscribe"]).toBe(`<${link}>`);
    expect(email?.html).toContain(`href="${link.replaceAll("&", "&amp;")}"`);

    await unsubscribeWithLink(new URL(link).searchParams.get("token") ?? "");
    fakeEmail.reset();
    await sendReviewDigest(systemCtx(orgA.id), { now: new Date(Date.now() + DAY) });

    expect(fakeEmail.sent().map((sent) => sent.to)).toEqual([[colleague.email]]);
  });

  it("sends each person one digest a day, however often the job is retried", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    await memberReview(orgs);
    const now = new Date();

    await sendReviewDigest(systemCtx(orgA.id), { now });
    await sendReviewDigest(systemCtx(orgA.id), { now });
    expect(fakeEmail.sent()).toHaveLength(1);

    await sendReviewDigest(systemCtx(orgA.id), { now: new Date(now.getTime() + DAY) });
    expect(fakeEmail.sent()).toHaveLength(2);
  });

  it("is sent only by the digest job, as the org's system ctx", async () => {
    const orgs = await seedTwoOrgs();
    await memberReview(orgs);

    for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx]) {
      await expect(sendReviewDigest(ctx)).rejects.toThrow(ForbiddenError);
    }
    expect(fakeEmail.sent()).toEqual([]);
  });
});

describe("before counting, the digest", () => {
  it("ends a review whose draft was deleted as gone, and doesn't count it", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const { mailbox, draft } = await memberReview(orgs);
    const review = (await listReviews(orgA.member.ctx)).at(0);
    mailbox.deleteDraft(draft.id);

    await sendReviewDigest(systemCtx(orgA.id));

    expect(fakeEmail.sent()).toEqual([]);
    expect(await listReviews(orgA.member.ctx)).toEqual([]);
    expect((await openReview(orgA.member.ctx, review?.id ?? "")).review.status).toBe("gone");
  });

  it("ends a review whose draft was sent from Gmail as done in the app", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const seeded = await twoWorkflows(orgs);
    const review = (await listReviews(orgA.member.ctx)).at(0);
    await anotherReview(orgs, seeded, seeded.refunds);
    seeded.mailbox.sendDraft(seeded.draft.id);

    await sendReviewDigest(systemCtx(orgA.id));

    expect(fakeEmail.sent().at(0)?.subject).toBe("1 review is waiting for you in Mycel");
    const ended = await openReview(orgA.member.ctx, review?.id ?? "");
    expect(ended.review.status).toBe("done_in_app");
  });
});
