// The suggest-edits action's write (ADR-0017): one documents.batchUpdate in suggest mode, so the
// edits wait in the Doc as suggestions and nothing in it changes until a person accepts them.
// Mycel writes as the person, so the IDs Docs returns are all that tells its suggestions from
// theirs. A batchUpdate isn't idempotent and leaves no marker, so before writing the step notes
// the suggestions already in the document (suggested_edit_writes); a retry whose earlier answer
// was lost finds the suggestions that write created, the ones new since, and doesn't suggest the
// edits again; one whose earlier write never landed finds none, and writes. A suggestion the
// person makes in the document in between would be taken for the step's: a known limit. IDs
// only: the text stays in the Doc (invariant 8).
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { batchUpdate, docs, liveDocument, suggestionIdsIn } from "./docs";
import { RunStepError } from "./failures";
import { runs, suggestedEditWrites } from "./schema";

/** What the suggest-edits action takes: the document, and Docs' own requests. */
export type SuggestEditsInput = { documentId: string; requests: Record<string, unknown>[] };

/** The suggestions a step made: their document, and the IDs Docs gave them. */
export type SuggestedEdits = { documentId: string; suggestionIds: string[] };

type Write = typeof suggestedEditWrites.$inferSelect;

/**
 * Suggests the edits in the document for the run step `marker` (`<runId>/<stepId>`), once:
 * a retry finds what an earlier try created. Fails the step, making nothing to review, when
 * Docs answers that it saved none of the suggestions (`ALL_FAILED_UNKNOWN_REASON`): the edits
 * may then have landed directly.
 */
export async function suggestEdits(
  ctx: Ctx,
  connectionId: string,
  input: SuggestEditsInput,
  marker: string,
): Promise<SuggestedEdits> {
  const { documentId } = input;
  const [runId = "", stepId = ""] = marker.split("/");
  const earlier = await writeOf(ctx, runId, stepId);
  if (earlier?.createdSuggestionIds != null && earlier.documentId === documentId) {
    return { documentId, suggestionIds: earlier.createdSuggestionIds };
  }
  const document = await docs(liveDocument(ctx, connectionId, documentId));
  const now = [...suggestionIdsIn(document)];
  if (earlier !== undefined && earlier.documentId === documentId) {
    // Suggestions new since the earlier try noted the document are what its write made.
    const created = now.filter((id) => !earlier.suggestionIdsBefore.includes(id));
    if (created.length > 0) {
      await recordCreated(ctx, earlier.id, created);
      return { documentId, suggestionIds: created };
    }
  }
  const step = { connectionId, runId, stepId, documentId };
  const write = await noteWrite(ctx, earlier, step, now);
  const answer = await docs(
    batchUpdate(ctx, connectionId, documentId, {
      requests: input.requests,
      writeControl: { writeMode: "SUGGEST" },
    }),
  );
  if (answer.commentUpdateState === "ALL_FAILED_UNKNOWN_REASON") {
    // Noted as having made no suggestions, so nothing ever writes the edits a second time.
    await recordCreated(ctx, write, []);
    throw new RunStepError(
      "suggestions_not_saved",
      "Docs saved none of the suggestions, so the edits may have changed the document directly.",
    );
  }
  const created = answer.suggestionResponses.flatMap((one) => one.createdSuggestionIds);
  await recordCreated(ctx, write, created);
  return { documentId, suggestionIds: created };
}

async function writeOf(ctx: Ctx, runId: string, stepId: string): Promise<Write | undefined> {
  const ofStep = and(eq(suggestedEditWrites.runId, runId), eq(suggestedEditWrites.stepId, stepId));
  return (await forOrg(ctx).select(suggestedEditWrites, { where: ofStep })).at(0);
}

// Notes the suggestions in the document before the write: a new row, or the earlier try's.
async function noteWrite(
  ctx: Ctx,
  earlier: Write | undefined,
  step: { connectionId: string; runId: string; stepId: string; documentId: string },
  suggestionIdsBefore: string[],
): Promise<string> {
  const db = forOrg(ctx);
  if (earlier !== undefined) {
    const update = { documentId: step.documentId, suggestionIdsBefore, createdSuggestionIds: null };
    await db.update(suggestedEditWrites, update, eq(suggestedEditWrites.id, earlier.id));
    return earlier.id;
  }
  // The run's provenance (invariant 2).
  const run = (await db.select(runs, { where: eq(runs.id, step.runId) })).at(0);
  if (run === undefined) throw new NotFoundError("run");
  const id = randomUUID();
  const provenance = { sourceRef: run.sourceRef, ownerScope: run.ownerScope };
  await db.insert(suggestedEditWrites, { id, ...step, ...provenance, suggestionIdsBefore });
  return id;
}

async function recordCreated(ctx: Ctx, id: string, created: string[]): Promise<void> {
  await forOrg(ctx).update(
    suggestedEditWrites,
    { createdSuggestionIds: created },
    eq(suggestedEditWrites.id, id),
  );
}
