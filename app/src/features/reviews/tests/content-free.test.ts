// Invariant 8 for reviews: a review points at its draft and fetches it live, so nothing from the
// message, the draft or a person's edit lands in any table, however the review goes.
import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { approveEditedReview, listReviews, openReview } from "../server";
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
    expect(opened.view?.message?.text).toContain(IN_MESSAGE);
    expect(opened.view?.draft.text).toContain(IN_DRAFT);
    await approveEditedReview(admin, id, { text: `Edited reply. Ref ${IN_EDIT}` });

    for (const marker of [IN_MESSAGE, IN_DRAFT, IN_EDIT]) {
      expect(await tablesHolding(marker), marker).toEqual([]);
    }
    // The scan does find what the tables hold.
    expect(await tablesHolding(orgs.orgA.admin.email)).toContain("user");
  });
});
