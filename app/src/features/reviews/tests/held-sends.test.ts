// Held sends on the Reviews page (ADR-0020): a custom write's request waits, held by Mycel, until
// a person approves it (as it is, or with its editable text edited) or declines it. Approving
// sends it once, whoever else acts at the same moment; whatever the outcome, the request is
// deleted the moment the review ends.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { heldSend, OUTLOOK_MESSAGE, REPLY_TEXT } from "@/db/testing/held-sends";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { disconnect } from "@/features/connections/server";
import { getRun } from "@/features/runtime/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { AlreadyHandledError, ConflictError, ValidationError } from "@/lib/errors";
import { DAY_MS } from "@/lib/time";
import type { FakeAppRequest } from "@/testing/fake-microsoft";
import { fakeNango } from "@/testing/fake-nango";
import {
  approveEditedReview,
  approveReview,
  checkWaitingReviews,
  declineReview,
  handOff,
  listReviews,
  openReview,
  reviewStats,
} from "../server";

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
});

const REPLY_PATH = `/v1.0/me/messages/${OUTLOOK_MESSAGE}/reply`;

const writes = (requests: FakeAppRequest[]) => requests.filter((r) => r.method !== "GET");
const reply = (comment: string) => ({
  method: "POST",
  path: REPLY_PATH,
  query: {},
  body: { comment },
});

describe("a held send's review", () => {
  it("shows the app, the action and the fields it would send", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, outlook } = await heldSend(orgs);

    const opened = await openReview(owner, reviewId);

    expect(opened.review).toMatchObject({ kind: "held_send", status: "waiting" });
    expect(opened.view).toEqual({
      kind: "held_send",
      app: "Microsoft 365",
      action: "microsoft.reply-to-message",
      description: "Reply to one Outlook message with a comment.",
      method: "POST",
      url: `https://graph.microsoft.com${REPLY_PATH}`,
      fields: [
        {
          name: "messageId",
          description: "The Outlook message's ID.",
          value: OUTLOOK_MESSAGE,
          editable: false,
        },
        {
          name: "comment",
          description: "The reply's text.",
          value: expect.stringContaining(REPLY_TEXT) as string,
          editable: true,
        },
      ],
    });
    expect(writes(outlook.requests)).toEqual([]);
  });

  it("sends exactly one request on approval, and approving again sends nothing", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, outlook } = await heldSend(orgs);
    const comment = commentOf(await openReview(owner, reviewId));

    await approveReview(owner, reviewId);
    await expect(approveReview(owner, reviewId)).rejects.toThrow(AlreadyHandledError);

    expect(writes(outlook.requests)).toEqual([reply(comment)]);
    expect(await openReview(owner, reviewId)).toMatchObject({
      review: { status: "approved", endedByUserId: orgs.orgA.admin.id },
      view: null,
    });
  });

  it("sends once when two people approve at the same moment; the second is told who did", async () => {
    const orgs = await seedTwoOrgs();
    const { admin, reviewId, outlook } = await heldSend(orgs, { owner: "org" });
    const member = orgs.orgA.member.ctx;

    const results = await Promise.allSettled([
      approveReview(admin, reviewId),
      approveReview(member, reviewId),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected");
    expect(refused?.reason).toBeInstanceOf(AlreadyHandledError);
    expect(writes(outlook.requests)).toHaveLength(1);
  });

  it("sends the edited text, and keeps neither it nor the request in any table", async () => {
    const orgs = await seedTwoOrgs();
    const MARKER = "MARKER-edit-81c2";
    const { owner, reviewId, outlook } = await heldSend(orgs);
    const edited = `Thanks Ada, the chairs ship Monday. ${MARKER}`;

    await approveEditedReview(owner, reviewId, { fields: { comment: edited } });

    expect(writes(outlook.requests)).toEqual([reply(edited)]);
    expect((await openReview(owner, reviewId)).review.status).toBe("edited_approved");
    expect(await tablesHolding(MARKER)).toEqual([]);
    expect(await tablesHolding("oak chairs come to")).toEqual([]);
  });

  it("refuses an edit to a field that isn't editable, sending nothing and waiting on", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, outlook } = await heldSend(orgs);

    await expect(
      approveEditedReview(owner, reviewId, { fields: { messageId: "another-message" } }),
    ).rejects.toThrow(ValidationError);

    expect(writes(outlook.requests)).toEqual([]);
    expect((await openReview(owner, reviewId)).review.status).toBe("waiting");
  });

  it("sends nothing on decline, and deletes the request", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, outlook } = await heldSend(orgs);

    await declineReview(owner, reviewId);

    expect(writes(outlook.requests)).toEqual([]);
    expect(await openReview(owner, reviewId)).toMatchObject({
      review: { status: "declined" },
      view: null,
    });
    await expect(approveReview(owner, reviewId)).rejects.toThrow(AlreadyHandledError);
    expect(writes(outlook.requests)).toEqual([]);
  });

  it("ends gone when the app no longer has what it was sent to", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, outlook } = await heldSend(orgs);
    outlook.deleteMessage(OUTLOOK_MESSAGE);

    await expect(approveReview(owner, reviewId)).rejects.toThrow(ConflictError);

    expect((await openReview(owner, reviewId)).review.status).toBe("gone");
  });
});

describe("a held send whose app doesn't confirm it was sent", () => {
  it.each(["error", "dropped"] as const)(
    "ends unconfirmed when the app took it but its answer was lost (%s), and is never sent again",
    async (how) => {
      const orgs = await seedTwoOrgs();
      const { owner, reviewId, outlook, runId } = await heldSend(orgs);
      const heldSendId = await heldSendIdOf(owner, runId);
      outlook.loseNextAnswer(how);

      await expect(approveReview(owner, reviewId)).rejects.toThrow(
        "its app didn't confirm it was sent",
      );
      await expect(approveReview(owner, reviewId)).rejects.toThrow(AlreadyHandledError);
      await checkWaitingReviews(systemCtx(orgs.orgA.id));

      expect(writes(outlook.requests)).toHaveLength(1);
      expect(await openReview(owner, reviewId)).toMatchObject({
        review: { status: "unconfirmed", endedByUserId: orgs.orgA.admin.id },
        view: null,
      });
      expect(await tablesHolding(heldSendId)).not.toContain("held_sends");
    },
  );

  it("ends unconfirmed when the proxy answers 500, which may have reached the app", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, outlook } = await heldSend(orgs);
    fakeNango.failWrites(1);

    await expect(approveReview(owner, reviewId)).rejects.toThrow(ConflictError);
    await expect(approveReview(owner, reviewId)).rejects.toThrow(AlreadyHandledError);

    expect(writes(outlook.requests)).toEqual([]);
    expect((await openReview(owner, reviewId)).review.status).toBe("unconfirmed");
  });

  it("waits on, still held, when Nango refused it before it reached the app", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, outlook, microsoftNangoId, runId } = await heldSend(orgs);
    const heldSendId = await heldSendIdOf(owner, runId);
    fakeNango.revokeAccess(microsoftNangoId);

    const refused = await approveReview(owner, reviewId).catch((error: unknown) => error);

    // The error names the call by its path template, never the input values filled into it.
    expect(String(refused)).toContain("/v1.0/me/messages/{messageId}/reply");
    expect(String(refused)).not.toContain(OUTLOOK_MESSAGE);
    expect(writes(outlook.requests)).toEqual([]);
    expect((await openReview(owner, reviewId)).review.status).toBe("waiting");
    expect(await tablesHolding(heldSendId)).toContain("held_sends");
  });
});

describe("a held send nobody acts on", () => {
  it("expires after 30 days, its request deleted, and is counted expired", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, system, reviewId, outlook, workflowId, runId } = await heldSend(orgs);
    const heldSendId = await heldSendIdOf(owner, runId);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 29 * DAY_MS);
    await checkWaitingReviews(system);
    expect((await openReview(owner, reviewId)).review.status).toBe("waiting");

    expect(await tablesHolding(heldSendId)).toContain("held_sends");

    vi.setSystemTime(Date.now() + 2 * DAY_MS);
    await checkWaitingReviews(system);

    expect(await tablesHolding(heldSendId)).not.toContain("held_sends");

    expect(await openReview(owner, reviewId)).toMatchObject({
      review: { status: "expired", endedByUserId: null },
      view: null,
    });
    await expect(approveReview(owner, reviewId)).rejects.toThrow(AlreadyHandledError);
    expect(writes(outlook.requests)).toEqual([]);
    const stats = await reviewStats(owner, { workflowId, since: new Date(0) });
    expect(stats.heldSends).toMatchObject({ waiting: 0, expired: 1 });
  });
});

describe("who sees a held send", () => {
  it("is a member's own: not found for an admin or another company's member", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId } = await heldSend(orgs, { owner: "member" });

    expect(await listReviews(owner)).toHaveLength(1);
    for (const ctx of [orgs.orgA.admin.ctx, orgs.orgB.member.ctx, orgs.orgB.admin.ctx]) {
      expect(await listReviews(ctx)).toEqual([]);
      await expect(openReview(ctx, reviewId)).rejects.toThrow("That review doesn't exist.");
      await expect(approveReview(ctx, reviewId)).rejects.toThrow("That review doesn't exist.");
    }
  });

  it("goes where its member hands it, and is sent from the member's own account", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, outlook } = await heldSend(orgs, { owner: "member", handoff: true });
    const admin = orgs.orgA.admin.ctx;

    await handOff(owner, reviewId, orgs.orgA.admin.id);
    await approveReview(admin, reviewId);

    expect(writes(outlook.requests)).toHaveLength(1);
    expect((await openReview(owner, reviewId)).review.status).toBe("approved");
  });

  it("is shared with whoever sees its workflow when an org connection made it", async () => {
    const orgs = await seedTwoOrgs();
    const { reviewId, outlook } = await heldSend(orgs, { owner: "org" });
    const member = orgs.orgA.member.ctx;

    expect(await listReviews(member)).toMatchObject([{ id: reviewId, kind: "held_send" }]);
    await approveReview(member, reviewId);

    expect(writes(outlook.requests)).toHaveLength(1);
  });
});

describe("what a held send records", () => {
  it("names the message that started its run, and its review", async () => {
    const orgs = await seedTwoOrgs();
    const { reviewId, message } = await heldSend(orgs);

    expect(await tablesHolding(message.id)).toContain("held_sends");
    expect(await tablesHolding(reviewId)).toContain("held_sends");
  });
});

describe("disconnecting", () => {
  it("the app's connection deletes its held sends and their reviews", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, microsoftId, runId } = await heldSend(orgs);
    const heldSendId = await heldSendIdOf(owner, runId);

    await disconnect(owner, microsoftId);

    expect(await listReviews(owner)).toEqual([]);
    await expect(openReview(owner, reviewId)).rejects.toThrow("That review doesn't exist.");
    expect(await tablesHolding(heldSendId)).not.toContain("held_sends");
  });

  it("the run's own connection deletes its held sends and their reviews too", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, google, runId } = await heldSend(orgs);
    const heldSendId = await heldSendIdOf(owner, runId);

    await disconnect(owner, google.id);

    expect(await listReviews(owner)).toEqual([]);
    await expect(openReview(owner, reviewId)).rejects.toThrow("That review doesn't exist.");
    expect(await tablesHolding(heldSendId)).toEqual([]);
    expect(await tablesHolding(runId)).toEqual([]);
  });
});

function commentOf(opened: Awaited<ReturnType<typeof openReview>>): string {
  if (opened.view?.kind !== "held_send") throw new Error("not a held send");
  return opened.view.fields.find((field) => field.name === "comment")?.value ?? "";
}

// The held send's ID, as the run's approval step recorded it.
async function heldSendIdOf(ctx: Ctx, runId: string): Promise<string> {
  const approval = (await getRun(ctx, runId)).steps.find((step) => step.type === "approval");
  const ids = (approval?.output as { heldSendIds?: string[] } | null)?.heldSendIds;
  if (ids?.length !== 1) throw new Error("no held send");
  return ids[0];
}
