// A run's approval step leaves a review waiting on the Reviews page, pointing at the draft the
// run made, and the run still ends `succeeded`.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { dryRun } from "@/features/runtime/server";
import { systemCtx } from "@/lib/ctx";
import { connectMailbox } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { listReviews, openReview } from "../server";
import { approvalRetried, exampleRun, pricingQuestion, REPLY, replySpec } from "./review-helpers";

beforeEach(resetDatabase);

describe("creating a review", () => {
  it("leaves one waiting review pointing at the run's draft, even when the approval step is retried", async () => {
    const { admin, google, workflowId, outcome } = await exampleRun({ runStep: approvalRetried });

    expect(outcome).toEqual({ status: "succeeded" });
    const reviews = await listReviews(admin);
    expect(reviews).toEqual([
      {
        id: expect.any(String) as string,
        kind: "approval",
        workflowId,
        workflowName: "Pricing replies",
        createdAt: expect.any(Date) as Date,
      },
    ]);
    const opened = await openReview(admin, reviews.at(0)?.id ?? "");
    expect(opened.review.status).toBe("waiting");
    expect(opened.view?.draft).toMatchObject({ text: REPLY });
    expect(google.mailbox.drafts()).toHaveLength(1);
  });

  it("is never made by Try it", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await grantCredits(systemCtx(orgA.id), 100);
    const google = await connectMailbox(admin, orgA.admin.email, [pricingQuestion()]);
    const message = google.mailbox.list(new URLSearchParams()).messages?.at(0);
    fakeAiGateway.text(REPLY);

    const result = await dryRun(admin, replySpec(), {
      connectionId: google.id,
      sourceRef: message?.id ?? "",
    });

    expect(result.ended).toBe("succeeded");
    expect(await listReviews(admin)).toEqual([]);
  });
});
