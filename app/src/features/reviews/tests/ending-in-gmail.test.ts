// A review its person finished in Gmail itself ends there: discovery's poll announces each
// message sent from the mailbox, and a waiting review in that thread on that connection asks
// its adapter, ending `done_in_app` (with nobody named) when the adapter says so.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { listConnections } from "@/features/connections/server";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import type { PendingItem } from "@/features/runtime/adapters";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { gmailMessageSent, type GmailMessageSent } from "@/lib/events";
import { fakeInngest } from "@/testing/fake-inngest";
import { endReviewsInThread, listReviews, openReview } from "../server";
import type { PendingForms } from "../types";
import { memberEscalation } from "./escalation-helpers";
import { memberReview } from "./review-helpers";

beforeEach(resetDatabase);

/** Polls the connection as its job would, and hands each sent message it announced on. */
async function pollAndEnd(system: Ctx, connectionId: string) {
  const before = fakeInngest.sent(gmailMessageSent.name).length;
  await pollConnection(system, connectionId);
  const sent = fakeInngest
    .sent(gmailMessageSent.name)
    .slice(before)
    .map((event) => gmailMessageSent.schema.parse(event.data));
  for (const message of sent) await endReviewsInThread(system, message);
  return sent;
}

/** Org A's member's draft review, on a mailbox discovery has backfilled. */
async function backfilledReview() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  const seeded = await memberReview(orgs);
  await backfillConnection(orgA.member.ctx, seeded.google.id);
  const review = (await listReviews(orgA.member.ctx)).at(0);
  if (review === undefined) throw new Error("no review");
  return { orgs, ...seeded, review, system: systemCtx(orgA.id) };
}

/** An adapter that records which items it was asked to check, and finds every one done. */
function checkingAdapter() {
  const checked: string[] = [];
  const adapter: PendingForms["approval"] = {
    prepare: () => Promise.reject(new Error("never prepared")),
    approve: () => Promise.reject(new Error("never approved")),
    check: (_ctx, item: PendingItem) => {
      checked.push(item.itemRef);
      return Promise.resolve("done_in_app");
    },
    view: () => Promise.reject(new Error("never viewed")),
  };
  const adapters: PendingForms = { approval: adapter, escalation: adapter, held_send: adapter };
  return { adapters, checked };
}

describe("ending a review finished in Gmail", () => {
  it("ends a draft sent from Gmail as done_in_app, ended by nobody", async () => {
    const { orgs, mailbox, draft, review, google, system } = await backfilledReview();
    const member = orgs.orgA.member.ctx;
    mailbox.sendDraft(draft.id);

    const sent = await pollAndEnd(system, google.id);

    expect(sent).toHaveLength(1);
    expect(await listReviews(member)).toEqual([]);
    expect((await openReview(member, review.id)).review).toMatchObject({
      status: "done_in_app",
      endedByUserId: null,
      endedBy: null,
    });
  });

  it("ends an escalation replied to from Gmail as done_in_app", async () => {
    const orgs = await seedTwoOrgs();
    const { orgA } = orgs;
    const { google, mailbox, message } = await memberEscalation(orgs);
    await backfillConnection(orgA.member.ctx, google.id);
    mailbox.add({
      from: orgA.member.email,
      to: ["customer@customer.test"],
      text: "Sorry about that, new chairs are on their way.",
      at: new Date(),
      sent: true,
      threadId: message.threadId,
    });

    await pollAndEnd(systemCtx(orgA.id), google.id);

    expect(await listReviews(orgA.member.ctx)).toEqual([]);
  });

  it("leaves a review waiting when a message is sent in another thread", async () => {
    const { orgs, mailbox, review, google, system } = await backfilledReview();
    mailbox.add({
      from: orgs.orgA.member.email,
      to: ["someone@else.test"],
      text: "Unrelated",
      at: new Date(),
      sent: true,
    });

    expect(await pollAndEnd(system, google.id)).toHaveLength(1);

    expect((await listReviews(orgs.orgA.member.ctx)).map((r) => r.id)).toEqual([review.id]);
  });

  it("checks only the waiting reviews in the message's thread on the message's connection", async () => {
    const { orgs, message, draft, review, google, system } = await backfilledReview();
    const { orgA } = orgs;
    const { adapters, checked } = checkingAdapter();
    const sent = (overrides: Partial<GmailMessageSent>): GmailMessageSent => ({
      orgId: orgA.id,
      connectionId: google.id,
      sourceRef: "sent-1",
      threadId: message.threadId,
      occurredAt: new Date().toISOString(),
      ...overrides,
    });

    await endReviewsInThread(system, sent({ threadId: "another-thread" }), adapters);
    // The admin's own mailbox, connected by memberReview: another connection in the same org.
    const adminMailbox = (await listConnections(orgA.admin.ctx)).connections.at(0);
    if (adminMailbox === undefined) throw new Error("no admin mailbox");
    await endReviewsInThread(system, sent({ connectionId: adminMailbox.id }), adapters);
    expect(checked).toEqual([]);
    expect((await listReviews(orgA.member.ctx)).map((r) => r.id)).toContain(review.id);

    await endReviewsInThread(system, sent({}), adapters);
    expect(checked).toEqual([draft.id]);
    expect((await listReviews(orgA.member.ctx)).map((r) => r.id)).not.toContain(review.id);
  });

  it("is only for jobs, and a sent message in another org ends nothing", async () => {
    const { orgs, message, review, google } = await backfilledReview();
    const { orgA, orgB } = orgs;
    const { adapters, checked } = checkingAdapter();
    const sent: GmailMessageSent = {
      orgId: orgA.id,
      connectionId: google.id,
      sourceRef: "sent-1",
      threadId: message.threadId,
      occurredAt: new Date().toISOString(),
    };

    await expect(endReviewsInThread(orgA.member.ctx, sent, adapters)).rejects.toThrow();
    await endReviewsInThread(systemCtx(orgB.id), sent, adapters);

    expect(checked).toEqual([]);
    expect((await listReviews(orgA.member.ctx)).map((r) => r.id)).toEqual([review.id]);
  });
});
