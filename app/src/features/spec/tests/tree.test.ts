import { describe, expect, it } from "vitest";
import { eachStep, findStep, mapStepLists, stepLocation, stepsAbove } from "../tree";
import type { Spec } from "../types";
import { validateSpec } from "../validate";
import { exampleSpec } from "./example-spec";

function parsed(input: unknown): Spec {
  const result = validateSpec(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.spec;
}

/** The example, its gate handing the message to a person when it doesn't hold. */
function escalating(): Spec {
  const spec = exampleSpec();
  spec.steps[1] = { ...spec.steps[1], else: "escalate" };
  return parsed(spec);
}

describe("eachStep", () => {
  it("visits every step at every depth in the order a run reaches them, each with its location and the steps above it", () => {
    const placed = eachStep(parsed(exampleSpec()));

    expect(
      placed.map(({ step, location, above }) => [step.id, location, above.map((s) => s.id)]),
    ).toEqual([
      ["classify", ["steps", 0], []],
      ["gate", ["steps", 1], ["classify"]],
      ["prices", ["steps", 1, "paths", 0, "steps", 0], ["classify", "gate"]],
      ["draft", ["steps", 1, "paths", 0, "steps", 1], ["classify", "gate", "prices"]],
      ["approve", ["steps", 1, "paths", 0, "steps", 2], ["classify", "gate", "prices", "draft"]],
    ]);
  });
});

describe("findStep", () => {
  it("finds a step by its ID, and nothing for an ID no step has", () => {
    const spec = parsed(exampleSpec());

    expect(findStep(spec, "prices")).toMatchObject({
      type: "tool",
      action: "google-sheet.read-range",
    });
    expect(findStep(spec, "missing")).toBeUndefined();
  });
});

describe("stepsAbove", () => {
  it("lists what a step may use: the steps before it on its own path, not a sibling path's", () => {
    const spec = parsed(exampleSpec());

    expect(stepsAbove(spec, "draft").map((step) => step.id)).toEqual([
      "classify",
      "gate",
      "prices",
    ]);
    expect(stepsAbove(spec, "classify")).toEqual([]);
    expect(stepsAbove(escalating(), "gate-escalate").map((step) => step.id)).toEqual([
      "classify",
      "gate",
    ]);
    expect(stepsAbove(spec, "missing")).toEqual([]);
  });
});

describe("stepLocation", () => {
  it("names where a step sits in the spec, for an issue about it", () => {
    const spec = parsed(exampleSpec());

    expect(stepLocation(spec, "draft")).toEqual(["steps", 1, "paths", 0, "steps", 1]);
    expect(stepLocation(spec, "missing")).toBeUndefined();
  });
});

describe("mapStepLists", () => {
  it("rewrites every list of steps, leaving the rest of the spec as it was", () => {
    const spec = parsed(exampleSpec());

    const without = mapStepLists(spec, (steps) => steps.filter((step) => step.type !== "approval"));

    expect(eachStep(without).map(({ step }) => step.id)).toEqual([
      "classify",
      "gate",
      "prices",
      "draft",
    ]);
    expect({ ...without, steps: spec.steps }).toEqual(spec);
    expect(eachStep(spec)).toHaveLength(5);
  });
});
