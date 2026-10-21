import { describe, expect, it } from "vitest";
import { addStep, issuesByStep, moveStep, readSpecJson, removeStep, updateStep } from "../edit";
import { formatSpec } from "../format";
import type { StoredSpec } from "../stored";
import { upgradeSpec } from "../upgrade";
import { validateSpec } from "../validate";
import { exampleSpec } from "./example-spec";

function draftOf(value: unknown) {
  const read = readSpecJson(JSON.stringify(value));
  if (!read.ok) throw new Error(read.message);
  return read.draft;
}

describe("readSpecJson", () => {
  it("reads a spec, edits in JSON included", () => {
    const text = formatSpec(exampleSpec()).replace("Is this a pricing inquiry?", "Pricing?");

    const read = readSpecJson(text);

    expect(read.ok && read.draft.steps[0]?.question).toBe("Pricing?");
  });

  it("refuses text that isn't JSON, or isn't a spec with a list of steps", () => {
    expect(readSpecJson('{"steps": [').ok).toBe(false);
    expect(readSpecJson("[]").ok).toBe(false);
    expect(readSpecJson('{"steps": "none"}').ok).toBe(false);
    expect(readSpecJson('{"steps": [1]}').ok).toBe(false);
  });

  it("reads a v2 spec as it's written, paths and all", () => {
    const v2 = upgradeSpec(exampleSpec() as StoredSpec);

    expect(readSpecJson(JSON.stringify(v2))).toEqual({ ok: true, draft: v2 });
  });

  it("reads a spec with no steps yet as one with an empty list", () => {
    expect(readSpecJson('{"specVersion": 1}')).toEqual({
      ok: true,
      draft: { specVersion: 1, steps: [] },
    });
  });
});

describe("editing steps", () => {
  it("changes a step's fields, leaving out the ones set to undefined", () => {
    const draft = draftOf(exampleSpec());

    const edited = updateStep(draft, 0, {
      question: "Is this about prices?",
      checks: { minP: 0.9 },
      role: undefined,
    });

    expect(edited.steps[0]).toEqual({
      id: "classify",
      type: "classify",
      question: "Is this about prices?",
      labels: ["yes", "no"],
      checks: { minP: 0.9 },
    });
    expect(draft.steps[0]?.question).toBe("Is this a pricing inquiry?");
  });

  it("adds a step of each type that validates once its blanks are filled, with a fresh ID", () => {
    let draft = draftOf(exampleSpec());
    for (const type of ["classify", "escalate", "approval"] as const) {
      draft = addStep(draft, type);
    }

    expect(draft.steps.slice(-3).map((step) => step.id)).toEqual([
      "classify-2",
      "escalate",
      "approval",
    ]);
    expect(draft.steps.at(-1)).toEqual({
      id: "approval",
      type: "approval",
      channel: "gmail_drafts",
    });
  });

  it("adds steps that, filled in, make a valid spec", () => {
    let draft = draftOf({ ...exampleSpec(), steps: [] });
    draft = addStep(draft, "classify");
    draft = updateStep(draft, 0, { question: "Pricing?" });
    draft = addStep(draft, "escalate");
    draft = updateStep(draft, 1, { reason: "A person should answer." });

    expect(validateSpec(draft).ok).toBe(true);
  });

  it("removes and reorders steps", () => {
    const draft = draftOf(exampleSpec());

    expect(removeStep(draft, 1).steps.map((step) => step.id)).toEqual([
      "classify",
      "prices",
      "draft",
      "approve",
    ]);
    expect(moveStep(draft, 2, -1).steps.map((step) => step.id)).toEqual([
      "classify",
      "prices",
      "gate",
      "draft",
      "approve",
    ]);
    expect(moveStep(draft, 0, -1)).toBe(draft);
    expect(moveStep(draft, 4, 1)).toBe(draft);
  });
});

describe("issuesByStep", () => {
  it("puts each issue on the step it's about, at the field inside it", () => {
    const grouped = issuesByStep([
      { path: ["steps", 2, "when", "label"], message: "No such label." },
      { path: ["steps", 0], message: "Duplicate ID." },
      { path: ["autonomy", "rung"], message: "Pick a rung." },
      { path: ["steps"], message: "Add a step." },
    ]);

    expect(grouped.spec).toEqual([
      { path: ["autonomy", "rung"], message: "Pick a rung." },
      { path: ["steps"], message: "Add a step." },
    ]);
    expect(grouped.steps.get(2)).toEqual([{ path: ["when", "label"], message: "No such label." }]);
    expect(grouped.steps.get(0)).toEqual([{ path: [], message: "Duplicate ID." }]);
    expect(grouped.steps.has(1)).toBe(false);
  });
});
