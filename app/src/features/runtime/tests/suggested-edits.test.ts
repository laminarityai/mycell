// A suggest-edits step (ADR-0017): its edits wait in the doc as suggestions, never as direct
// changes, with one review that links to the doc; a retried step suggests them once; a batch
// whose suggestions Docs didn't save fails the step and makes no review; and no record holds the
// doc's text or the suggested text.
import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import {
  OWN_SUGGESTION,
  STATUS_DOC,
  STATUS_LINE,
  SUBJECT,
  suggestedEdits,
} from "@/db/testing/suggested-edits";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { disconnect } from "@/features/connections/server";
import { listReviews, openReview } from "@/features/reviews/server";
import { fakeNango } from "@/testing/fake-nango";
import { executeRun, getRun } from "../server";
import { recordedBackoff, recordingStepRunner, recordsOf } from "./run-helpers";

beforeEach(resetDatabase);

describe("a suggest-edits step", () => {
  it("leaves its edits as suggestions, changing nothing in the doc, with one review linking to it", async () => {
    const orgs = await seedTwoOrgs();
    const { admin, outcome, docs, documentId, ownSuggestion, runId } = await suggestedEdits(orgs);

    expect(outcome).toEqual({ status: "succeeded" });
    expect(docs.text(documentId)).toBe(STATUS_DOC);
    expect(docs.mycelSuggestions(documentId)).toHaveLength(2);
    expect(docs.ownSuggestions(documentId)).toEqual([ownSuggestion]);
    expect(docs.writes).toEqual([
      { documentId, requests: expect.any(Array) as unknown[], writeMode: "SUGGEST" },
    ]);

    const reviews = await listReviews(admin);
    expect(reviews).toEqual([expect.objectContaining({ kind: "suggested_edits" })]);
    const opened = await openReview(admin, reviews[0]?.id ?? "");
    expect(opened.view).toEqual({
      kind: "suggested_edits",
      title: "Weekly status",
      link: `https://docs.google.com/document/d/${documentId}/edit`,
      changes: [
        { added: STATUS_LINE, removed: "{{status}}", restyled: false },
        { added: SUBJECT, removed: "", restyled: false },
      ],
      canEdit: true,
    });

    const run = await getRun(admin, runId);
    const ids = docs.mycelSuggestions(documentId);
    expect(run.steps).toMatchObject([
      { stepId: "read", status: "succeeded" },
      {
        stepId: "suggest",
        status: "succeeded",
        output: {
          fields: { documentId: { kind: "text" }, suggestionIds: { kind: "list", size: 2 } },
        },
      },
      {
        stepId: "suggest-approval",
        status: "succeeded",
        output: {
          awaiting: "human",
          channel: "suggested_edits",
          suggested: [{ documentId, suggestionIds: expect.arrayContaining(ids) as string[] }],
        },
      },
    ]);
  });

  it("keeps no doc text or suggested text in any run, step or review record", async () => {
    const orgs = await seedTwoOrgs();
    const { admin, runId, reviewId } = await suggestedEdits(orgs);
    await openReview(admin, reviewId);

    // The status line is the spec's own literal, kept with the workflow; the subject came from
    // the message, and the rest from the doc.
    const records = recordsOf(await getRun(admin, runId));
    expect(records).not.toContain(STATUS_LINE);
    for (const text of [SUBJECT, "Progress:", "Notes:", OWN_SUGGESTION]) {
      expect(records).not.toContain(text);
      expect(await tablesHolding(text)).toEqual([]);
    }
  });

  it("suggests its edits once when its write's answer is lost and the step is retried", async () => {
    const orgs = await seedTwoOrgs();
    const retry = recordedBackoff();
    const { admin, outcome, docs, documentId, ownSuggestion } = await suggestedEdits(orgs, {
      docs: "lose_answer",
      retry,
    });

    expect(outcome).toEqual({ status: "succeeded" });
    expect(retry.waits).toHaveLength(1);
    expect(docs.writes).toHaveLength(1);
    const ids = docs.mycelSuggestions(documentId);
    expect(ids).toHaveLength(2);
    expect(docs.ownSuggestions(documentId)).toEqual([ownSuggestion]);
    const reviews = await listReviews(admin);
    expect(reviews).toHaveLength(1);
    const opened = await openReview(admin, reviews[0]?.id ?? "");
    expect(opened.view).toMatchObject({ changes: [{ added: STATUS_LINE }, { added: SUBJECT }] });
  });

  it("suggests its edits again when its earlier write never reached Docs", async () => {
    const orgs = await seedTwoOrgs();
    const retry = recordedBackoff();
    fakeNango.failWrites(1);
    const { outcome, docs, documentId } = await suggestedEdits(orgs, { retry });

    expect(outcome).toEqual({ status: "succeeded" });
    expect(retry.waits).toHaveLength(1);
    expect(docs.writes).toHaveLength(1);
    expect(docs.mycelSuggestions(documentId)).toHaveLength(2);
  });

  it("makes no second set of suggestions or review when a finished run is replayed", async () => {
    const orgs = await seedTwoOrgs();
    const runner = recordingStepRunner();
    const { admin, system, runId, docs, documentId } = await suggestedEdits(orgs, {
      runStep: runner.runStep,
    });

    expect(await executeRun(system, runId, runner.runStep)).toEqual({ status: "succeeded" });
    expect(docs.writes).toHaveLength(1);
    expect(docs.mycelSuggestions(documentId)).toHaveLength(2);
    expect(await listReviews(admin)).toHaveLength(1);
  });

  it("fails, making no review, when Docs saves none of its suggestions", async () => {
    const orgs = await seedTwoOrgs();
    const retry = recordedBackoff();
    const { admin, outcome, runId, docs } = await suggestedEdits(orgs, {
      docs: "fail_save",
      retry,
    });

    expect(outcome).toEqual({ status: "failed" });
    expect(retry.waits).toEqual([]);
    expect(docs.writes).toHaveLength(1);
    expect(await listReviews(admin)).toEqual([]);
    const run = await getRun(admin, runId);
    expect(run.steps.at(-1)).toMatchObject({
      stepId: "suggest",
      status: "failed",
      errorCode: "suggestions_not_saved",
    });
  });

  it("goes with its connection: the review and what the step noted are deleted", async () => {
    const orgs = await seedTwoOrgs();
    const { admin, google, documentId } = await suggestedEdits(orgs);
    // The spec names the doc, so the workflow keeps its ID.
    const spec = ["workflow_versions", "workflows"];
    expect(await tablesHolding(documentId)).toEqual([
      "reviews",
      "run_steps",
      "suggested_edit_writes",
      ...spec,
    ]);

    await disconnect(admin, google.id);

    expect(await tablesHolding(documentId)).toEqual(spec);
  });
});
