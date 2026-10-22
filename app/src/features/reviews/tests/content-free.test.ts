// Invariant 8 for reviews: a review points at its draft and fetches it live, so nothing from the
// message, the draft or a person's edit lands in any table, however the review goes.
import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { approveEditedReview, listReviews, markDone, openReview } from "../server";
import { escalationRun, refundQuestion } from "./escalation-helpers";
import { exampleRun, pricingQuestion } from "./review-helpers";

beforeEach(resetDatabase);

const IN_MESSAGE = "marker-in-message-5b1e";
const IN_DRAFT = "marker-in-draft-0c7d";
const IN_EDIT = "marker-in-edit-93fa";

describe("a review's content", () => {
  it("appears in no column of any table: the message, the draft or an edit", async () => {
    const { orgs, admin } = await exampleRun({
      message: pricingQuestion({ text: `What would 30 oak chairs cost? Ref ${IN_MESSAGE}` }),
      reply: `30 oak chairs come to 2,400 GBP. Ref ${IN_DRAFT}`,
    });
    const review = (await listReviews(admin)).at(0);
    const id = review?.id ?? "";

    const opened = await openReview(admin, id);
    expect(opened.view).toMatchObject({
      message: { text: expect.stringContaining(IN_MESSAGE) as string },
    });
    expect(opened.view).toMatchObject({
      kind: "draft",
      draft: { text: expect.stringContaining(IN_DRAFT) as string },
    });
    await approveEditedReview(admin, id, { text: `Edited reply. Ref ${IN_EDIT}` });

    for (const marker of [IN_MESSAGE, IN_DRAFT, IN_EDIT]) {
      expect(await tablesHolding(marker), marker).toEqual([]);
    }
    // The scan does find what the tables hold.
    expect(await tablesHolding(orgs.orgA.admin.email)).toContain("user");
  });

  it("appears in no column of any table for an escalation: its subject or its message", async () => {
    const IN_SUBJECT = "marker-in-subject-e41a";
    const { admin } = await escalationRun({
      message: refundQuestion({
        subject: `Scratched chairs ${IN_SUBJECT}`,
        text: `Two chairs arrived scratched. Ref ${IN_MESSAGE}`,
      }),
    });
    const id = (await listReviews(admin)).at(0)?.id ?? "";

    const opened = await openReview(admin, id);
    expect(opened.view).toMatchObject({
      message: { text: expect.stringContaining(IN_MESSAGE) as string },
    });
    await markDone(admin, id);

    for (const marker of [IN_SUBJECT, IN_MESSAGE]) {
      expect(await tablesHolding(marker), marker).toEqual([]);
    }
  });
});
