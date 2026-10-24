import { describe, expect, it } from "vitest";
import { validateSpec } from "../validate";
import { exampleSpec } from "./example-spec";

describe("validateSpec", () => {
  it("accepts the architecture's example spec", () => {
    const result = validateSpec(exampleSpec());

    expect(result).toMatchObject({ ok: true, spec: { id: "pricing-inquiry-replies" } });
  });

  it("refuses a step that names the embed role, whose model only turns text into vectors", () => {
    const spec = exampleSpec();
    spec.steps[0] = { ...spec.steps[0], role: "embed" };

    expect(issuePaths(spec)).toEqual([["steps", 0, "role"]]);
  });

  it("refuses a duplicate step ID at the second step that uses it", () => {
    const spec = exampleSpec();
    spec.steps[4] = { ...spec.steps[4], id: "classify" };

    expect(issuePaths(spec)).toEqual([["steps", 4, "id"]]);
  });

  it("refuses a draft context that names a later step", () => {
    const spec = exampleSpec();
    spec.steps[3] = { ...spec.steps[3], context: ["trigger.message", "approve"] };

    expect(issuePaths(spec)).toEqual([["steps", 3, "context", 1]]);
  });

  it("refuses a branch on a step that comes after it", () => {
    const spec = exampleSpec();
    spec.steps[1] = { ...spec.steps[1], when: { step: "prices", label: "yes", minP: 0.85 } };

    expect(issuePaths(spec)).toEqual([["steps", 1, "when", "step"]]);
  });

  it("refuses a tool input that reads a later step, and accepts one that reads the trigger", () => {
    const spec = exampleSpec();
    spec.steps[2] = {
      ...spec.steps[2],
      input: {
        spreadsheetId: { from: "draft.id" },
        range: [{ from: "trigger.messageId" }, { from: "later.field" }],
      },
    };

    expect(issuePaths(spec)).toEqual([
      ["steps", 2, "input", "spreadsheetId", "from"],
      ["steps", 2, "input", "range", 1, "from"],
    ]);
  });

  it("checks a reference anywhere inside an input's lists and records", () => {
    const spec = exampleSpec();
    spec.steps[2] = {
      ...spec.steps[2],
      input: {
        spreadsheetId: "sheet-1",
        range: "Prices!A1:C50",
        edits: [
          { insertText: { text: { from: "classify.label" }, location: { index: 1 } } },
          { insertText: { text: { from: "draft.text" }, endOfSegmentLocation: {} } },
        ],
      },
    };

    expect(issuePaths(spec)).toEqual([
      ["steps", 2, "input", "edits", 1, "insertText", "text", "from"],
    ]);
  });

  it("reads a record whose only key is `from` as a reference, so it must be written as one", () => {
    const spec = exampleSpec();
    spec.steps[2] = {
      ...spec.steps[2],
      input: { spreadsheetId: "sheet-1", range: { nested: { from: "not a reference" } } },
    };

    expect(validateSpec(spec).ok).toBe(false);
  });

  it("refuses a step that refers to itself", () => {
    const spec = exampleSpec();
    spec.steps[3] = { ...spec.steps[3], context: ["draft"] };

    expect(issuePaths(spec)).toEqual([["steps", 3, "context", 0]]);
  });

  it("refuses org_memory as draft context until memory exists", () => {
    const spec = exampleSpec();
    spec.steps[3] = { ...spec.steps[3], context: ["prices", "org_memory"] };

    const result = validateSpec(spec);

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          path: ["steps", 3, "context", 1],
          message: expect.stringMatching(/^Org memory isn't available/) as string,
        },
      ],
    });
  });

  it("refuses an unknown step type at that step's type", () => {
    const spec = exampleSpec();
    spec.steps[2] = { id: "prices", type: "webhook", url: "https://example.com" };

    expect(issuePaths(spec)).toEqual([["steps", 2, "type"]]);
  });

  it("refuses a branch on a label the step doesn't produce, or on a step that isn't a classify", () => {
    const spec = exampleSpec();
    spec.steps[1] = { ...spec.steps[1], when: { step: "classify", label: "maybe", minP: 0.5 } };
    spec.steps.push({
      id: "gate-2",
      type: "branch",
      when: { step: "prices", label: "yes", minP: 0.5 },
      else: "escalate",
    });

    expect(issuePaths(spec)).toEqual([
      ["steps", 1, "when", "label"],
      ["steps", 5, "when", "step"],
    ]);
  });

  it("refuses a misspelled field, naming it, but ignores a risk field anywhere", () => {
    const spec = exampleSpec();
    spec.risk = "read";
    spec.steps[3] = { ...spec.steps[3], risk: "read" };
    spec.steps[0] = { ...spec.steps[0], chekcs: { minP: 0.5 } };

    expect(issuePaths(spec)).toEqual([["steps", 0]]);
    expect(validateSpec(spec)).toMatchObject({
      issues: [{ message: expect.stringContaining("chekcs") as string }],
    });
  });

  it("accepts a schema check in the supported JSON Schema subset", () => {
    const spec = exampleSpec();
    const schema = {
      type: "object",
      required: ["label"],
      additionalProperties: false,
      properties: {
        label: { type: "string", enum: ["yes", "no"], minLength: 2 },
        p: { type: ["number", "null"], minimum: 0, maximum: 1 },
        tags: { type: "array", items: { type: "string" }, maxItems: 3 },
      },
    };
    spec.steps[0] = { ...spec.steps[0], checks: { schema, minP: 0.5 } };

    expect(validateSpec(spec)).toMatchObject({ ok: true });
  });

  it("refuses minP on a step that isn't a classify, and requiredFields an extract lacks", () => {
    const spec = {
      ...exampleSpec(),
      steps: [
        {
          id: "details",
          type: "extract",
          role: "fast",
          fields: { city: { type: "string", description: "Where to deliver" } },
          checks: { minP: 0.5, requiredFields: ["city", "quantity"] },
        },
        { id: "stop", type: "escalate", reason: "Unclear", checks: { requiredFields: ["city"] } },
      ],
    };

    expect(validateSpec(spec)).toMatchObject({
      ok: false,
      issues: [
        { path: ["steps", 0, "checks", "minP"], message: "Only a classify step has a p to check." },
        {
          path: ["steps", 0, "checks", "requiredFields", 1],
          message: '"details" has no field "quantity".',
        },
        {
          path: ["steps", 1, "checks", "requiredFields"],
          message: "Only an extract step has fields to require.",
        },
      ],
    });
  });

  it("refuses a schema check keyword outside the subset, at its path", () => {
    const spec = exampleSpec();
    const schema = { type: "object", properties: { label: { pattern: "^y" } } };
    spec.steps[0] = { ...spec.steps[0], checks: { schema } };

    expect(issuePaths(spec)).toEqual([["steps", 0, "checks", "schema", "properties", "label"]]);
    expect(validateSpec(spec)).toMatchObject({
      issues: [{ message: expect.stringContaining("pattern") as string }],
    });
  });

  it("accepts a hand-off setting, which is off unless it says so", () => {
    const allowed = validateSpec({ ...exampleSpec(), review: { handoff: true } });
    const unsaid = validateSpec({ ...exampleSpec(), review: {} });

    expect(allowed).toMatchObject({ ok: true, spec: { review: { handoff: true } } });
    expect(unsaid).toMatchObject({ ok: true, spec: { review: { handoff: false } } });
    expect(issuePaths({ ...exampleSpec(), review: { handoff: "yes" } })).toEqual([
      ["review", "handoff"],
    ]);
    expect(issuePaths({ ...exampleSpec(), review: { handOff: true } })).toEqual([["review"]]);
  });
});

describe("validateSpec on a v2 spec", () => {
  /** The example as v2: classify, then a branch whose one path reads prices and drafts. */
  function v2Spec() {
    const result = validateSpec(exampleSpec());
    if (!result.ok) throw new Error("the example is valid");
    return JSON.parse(JSON.stringify(result.spec)) as {
      steps: [Record<string, unknown>, Record<string, unknown> & { paths: object[] }];
    };
  }
  const branchWith = (fields: Record<string, unknown>) => {
    const spec = v2Spec();
    spec.steps[1] = { ...spec.steps[1], ...fields };
    return spec;
  };
  const path = (checks: unknown[]) => ({
    id: "pricing",
    name: "Pricing",
    condition: { combine: "any", checks },
    steps: [],
  });

  it("accepts the upgraded example as it is, and v1 input comes back as v2", () => {
    const spec = v2Spec();

    expect(validateSpec(spec)).toEqual({ ok: true, spec });
    expect(validateSpec(exampleSpec())).toMatchObject({ ok: true, spec: { specVersion: 2 } });
  });

  it("refuses a branch check on a step that isn't a classify above the branch, or a label it lacks", () => {
    const later = path([{ classify: "prices", is: "yes", minP: 0.5 }]);
    const missing = path([{ classify: "classify", is: "maybe", minP: 0.5 }]);

    expect(issuePaths(branchWith({ paths: [later] }))).toEqual([
      ["steps", 1, "paths", 0, "condition", "checks", 0, "classify"],
    ]);
    expect(issuePaths(branchWith({ paths: [missing] }))).toEqual([
      ["steps", 1, "paths", 0, "condition", "checks", 0, "is"],
    ]);
  });

  it("refuses a path ID a step or another path already has", () => {
    const spec = branchWith({ otherwise: { id: "classify", steps: [] } });

    expect(issuePaths(spec)).toEqual([["steps", 1, "otherwise", "id"]]);
  });

  it("types a check's value by its operator", () => {
    const checks = [
      { subject: { from: "trigger.subject" }, op: "contains", value: "quote" },
      { subject: { from: "trigger.subject" }, op: "more_than", value: "five" },
      { subject: { from: "trigger.has_attachment" }, op: "is_yes", value: true },
    ];

    expect(issuePaths(branchWith({ paths: [path(checks)] }))).toEqual([
      ["steps", 1, "paths", 0, "condition", "checks", 1],
      ["steps", 1, "paths", 0, "condition", "checks", 2],
    ]);
  });

  it("accepts every match", () => {
    const classify = { classify: "classify", is: "yes", minP: 0.5 };
    const spec = branchWith({
      mode: "every",
      paths: [path([classify]), { ...path([classify]), id: "other" }],
    });

    expect(validateSpec(spec)).toMatchObject({ ok: true });
  });
});

function issuePaths(spec: unknown) {
  const result = validateSpec(spec);
  if (result.ok) throw new Error("expected the spec to be refused");
  return result.issues.map((issue) => issue.path);
}
