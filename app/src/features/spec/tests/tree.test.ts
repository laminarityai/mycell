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

describe("eachStep", () => {
  it("visits every step in the order a run reaches them, each with its location and the steps above it", () => {
    const placed = eachStep(parsed(exampleSpec()));

    expect(
      placed.map(({ step, location, above }) => [step.id, location, above.map((s) => s.id)]),
    ).toEqual([
      ["classify", ["steps", 0], []],
      ["gate", ["steps", 1], ["classify"]],
      ["prices", ["steps", 2], ["classify", "gate"]],
      ["draft", ["steps", 3], ["classify", "gate", "prices"]],
      ["approve", ["steps", 4], ["classify", "gate", "prices", "draft"]],
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
  it("lists what a step may use: the steps before it on its own path", () => {
    const spec = parsed(exampleSpec());

    expect(stepsAbove(spec, "draft").map((step) => step.id)).toEqual([
      "classify",
      "gate",
      "prices",
    ]);
    expect(stepsAbove(spec, "classify")).toEqual([]);
    expect(stepsAbove(spec, "missing")).toEqual([]);
  });
});

describe("stepLocation", () => {
  it("names where a step sits in the spec, for an issue about it", () => {
    const spec = parsed(exampleSpec());

    expect(stepLocation(spec, "draft")).toEqual(["steps", 3]);
    expect(stepLocation(spec, "missing")).toBeUndefined();
  });
});

describe("mapStepLists", () => {
  it("rewrites every list of steps, leaving the rest of the spec as it was", () => {
    const spec = parsed(exampleSpec());

    const without = mapStepLists(spec, (steps) => steps.filter((step) => step.type !== "approval"));

    expect(without.steps.map((step) => step.id)).toEqual(["classify", "gate", "prices", "draft"]);
    expect({ ...without, steps: spec.steps }).toEqual(spec);
    expect(spec.steps).toHaveLength(5);
  });
});
