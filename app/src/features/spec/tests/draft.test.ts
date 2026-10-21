import { describe, expect, it } from "vitest";
import { issuesByTarget, readDraftTree, readSpecJson } from "../draft";
import { formatSpec } from "../format";
import type { StoredSpec } from "../stored";
import { upgradeSpec } from "../upgrade";
import { exampleSpec } from "./example-spec";
import { triageSpec } from "./triage-spec";

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

describe("issuesByTarget", () => {
  it("puts each issue on the step or path it's about, the rest on the spec", () => {
    const draft = triageSpec();
    const issues = [
      { path: ["steps", 2, "paths", 1, "steps", 0, "instructions"], message: "Say what to write." },
      { path: ["steps", 2, "paths", 0, "condition", "checks", 0, "is"], message: "No such label." },
      { path: ["steps", 2, "otherwise", "steps"], message: "Odd." },
      { path: ["steps", 2, "mode"], message: "Pick a mode." },
      { path: ["steps", 0], message: "Duplicate ID." },
      { path: ["autonomy", "rung"], message: "Pick a rung." },
      { path: ["steps"], message: "Add a step." },
    ];

    const grouped = issuesByTarget(draft, issues);

    expect(grouped.spec).toEqual([issues[5], issues[6]]);
    expect(Object.fromEntries(grouped.byId)).toEqual({
      reply: [issues[0]],
      complaint: [issues[1]],
      rest: [issues[2]],
      route: [issues[3]],
      kind: [issues[4]],
    });
  });
});

describe("readDraftTree", () => {
  it("reads the draft's steps as a spec, whatever its settings say", () => {
    const draft = { ...triageSpec(), id: "", autonomy: { rung: 2 } };

    const tree = readDraftTree(draft);

    expect(tree?.steps.map((step) => step.id)).toEqual(["kind", "details", "route"]);
  });

  it("reads a draft with no steps as an empty tree, and refuses steps that don't validate", () => {
    expect(readDraftTree({ ...triageSpec(), steps: [] })?.steps).toEqual([]);
    expect(readDraftTree({ ...triageSpec(), steps: [{ id: "x", type: "classify" }] })).toBeNull();
  });
});
