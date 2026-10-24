// Suggested edits on the Reviews page (ADR-0017): approving accepts exactly the step's
// suggestions and declining rejects them, leaving the person's own alone either way; acting a
// second time, or after a colleague, changes nothing in the doc; and the review ends by itself
// once no suggestion of the step's is left in the doc, or the doc is gone.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import {
  OWN_SUGGESTION,
  STATUS_DOC,
  STATUS_LINE,
  SUBJECT,
  suggestedEdits,
} from "@/db/testing/suggested-edits";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { AlreadyHandledError, ValidationError } from "@/lib/errors";
import {
  approveEditedReview,
  approveReview,
  checkWaitingReviews,
  declineReview,
  handOff,
  listReviews,
  openReview,
} from "../server";

beforeEach(resetDatabase);

// The doc as it reads once the step's suggestions are accepted.
const ACCEPTED = STATUS_DOC.replace("{{status}}", STATUS_LINE).replace(/\n$/, `${SUBJECT}\n`);

describe("approving suggested edits", () => {
  it("accepts exactly the step's suggestions, leaving the person's own", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, docs, documentId, ownSuggestion } = await suggestedEdits(orgs);
    const mycel = docs.mycelSuggestions(documentId);

    await approveReview(owner, reviewId);

    expect(docs.text(documentId)).toBe(ACCEPTED);
    expect(docs.mycelSuggestions(documentId)).toEqual([]);
    expect(docs.ownSuggestions(documentId)).toEqual([ownSuggestion]);
    const accepted = docs.writes.at(-1);
    expect(accepted?.writeMode).toBe("EDIT");
    expect(accepted?.requests).toEqual(
      mycel.map((suggestionId) => ({ acceptSuggestion: { suggestionId } })),
    );
    expect((await openReview(owner, reviewId)).review).toMatchObject({ status: "approved" });
  });

  it("accepts only what's left when the person handled some in Docs first", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, docs, documentId } = await suggestedEdits(orgs);
    const [first, second] = docs.mycelSuggestions(documentId);
    docs.handleInDocs(documentId, first, "reject");

    await approveReview(owner, reviewId);

    expect(docs.writes.at(-1)?.requests).toEqual([{ acceptSuggestion: { suggestionId: second } }]);
    expect(docs.mycelSuggestions(documentId)).toEqual([]);
  });

  it("is refused with edits: suggestions are changed in Docs", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, docs } = await suggestedEdits(orgs);
    const writes = docs.writes.length;

    await expect(approveEditedReview(owner, reviewId, { text: "Other text" })).rejects.toThrow(
      ValidationError,
    );
    expect(docs.writes).toHaveLength(writes);
  });

  it("offers only the doc's link when the person can't edit it, and approving is refused", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, docs, documentId } = await suggestedEdits(orgs, {
      access: "comment",
    });

    expect(docs.mycelSuggestions(documentId)).toHaveLength(2);
    expect((await openReview(owner, reviewId)).view).toMatchObject({
      kind: "suggested_edits",
      link: `https://docs.google.com/document/d/${documentId}/edit`,
      canEdit: false,
    });
    await expect(approveReview(owner, reviewId)).rejects.toThrow(ValidationError);
    expect(docs.mycelSuggestions(documentId)).toHaveLength(2);
    expect((await openReview(owner, reviewId)).review).toMatchObject({ status: "waiting" });
  });
});

describe("declining suggested edits", () => {
  it("rejects exactly the step's suggestions, leaving the doc and the person's own", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, docs, documentId, ownSuggestion } = await suggestedEdits(orgs);
    const mycel = docs.mycelSuggestions(documentId);

    await declineReview(owner, reviewId);

    expect(docs.text(documentId)).toBe(STATUS_DOC);
    expect(docs.mycelSuggestions(documentId)).toEqual([]);
    expect(docs.ownSuggestions(documentId)).toEqual([ownSuggestion]);
    expect(docs.writes.at(-1)?.requests).toEqual(
      mycel.map((suggestionId) => ({ rejectSuggestion: { suggestionId } })),
    );
    expect((await openReview(owner, reviewId)).review).toMatchObject({ status: "declined" });
  });
});

describe("acting on suggested edits that were already handled", () => {
  it("changes nothing in the doc when approved or declined a second time", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, docs, documentId } = await suggestedEdits(orgs);
    await approveReview(owner, reviewId);
    const writes = docs.writes.length;

    await expect(approveReview(owner, reviewId)).rejects.toThrow(AlreadyHandledError);
    await expect(declineReview(owner, reviewId)).rejects.toThrow(AlreadyHandledError);

    expect(docs.writes).toHaveLength(writes);
    expect(docs.text(documentId)).toBe(ACCEPTED);
  });

  it("changes nothing in the doc when a colleague it was handed to acted first", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, docs, documentId } = await suggestedEdits(orgs, {
      owner: "member",
      handoff: true,
    });
    const colleague = await seedUser(orgs.orgA.id, "colleague@org-a.test", "member");
    await handOff(owner, reviewId, colleague.id);
    await declineReview(colleague.ctx, reviewId);
    const writes = docs.writes.length;

    await expect(approveReview(owner, reviewId)).rejects.toThrow(AlreadyHandledError);

    expect(docs.writes).toHaveLength(writes);
    expect(docs.text(documentId)).toBe(STATUS_DOC);
    expect(docs.mycelSuggestions(documentId)).toEqual([]);
  });
});

describe("suggested edits finished in Docs", () => {
  it("wait while any of the step's suggestions is left, and end done in the app once none is", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, system, reviewId, docs, documentId, ownSuggestion } = await suggestedEdits(orgs);
    const [first, second] = docs.mycelSuggestions(documentId);

    docs.handleInDocs(documentId, first, "accept");
    await checkWaitingReviews(system);
    expect(await listReviews(owner)).toMatchObject([{ id: reviewId }]);

    docs.handleInDocs(documentId, second, "reject");
    await checkWaitingReviews(system);
    expect(await listReviews(owner)).toEqual([]);
    expect((await openReview(owner, reviewId)).review).toMatchObject({
      status: "done_in_app",
      endedByUserId: null,
    });
    // The person's own suggestion was never Mycel's to wait on.
    expect(docs.ownSuggestions(documentId)).toEqual([ownSuggestion]);
  });

  it("end done in the app on opening, once the person handled them all in Docs", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId, docs, documentId } = await suggestedEdits(orgs);
    for (const id of docs.mycelSuggestions(documentId)) docs.handleInDocs(documentId, id, "accept");

    const opened = await openReview(owner, reviewId);

    expect(opened).toMatchObject({ review: { status: "done_in_app" }, view: null });
  });

  it("end gone when the doc is deleted", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, system, reviewId, docs, documentId } = await suggestedEdits(orgs);
    docs.remove(documentId);

    await checkWaitingReviews(system);

    expect((await openReview(owner, reviewId)).review).toMatchObject({ status: "gone" });
  });

  it("show the person's own suggestion nowhere in the review", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, reviewId } = await suggestedEdits(orgs);

    const opened = await openReview(owner, reviewId);

    expect(JSON.stringify(opened.view)).not.toContain(OWN_SUGGESTION.trim());
  });
});
