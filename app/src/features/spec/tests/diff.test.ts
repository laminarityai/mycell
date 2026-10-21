import { describe, expect, it } from "vitest";
import { diffSpecs } from "../diff";
import type { Spec } from "../types";
import { validateSpec } from "../validate";
import { exampleSpec } from "./example-spec";

function parsed(input: unknown): Spec {
  const result = validateSpec(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.spec;
}

describe("diffSpecs", () => {
  it("marks every step added when there is no base spec", () => {
    const diff = diffSpecs(null, parsed(exampleSpec()));

    expect(diff.steps.map((step) => [step.id, step.change])).toEqual([
      ["classify", "added"],
      ["gate", "added"],
      ["prices", "added"],
      ["draft", "added"],
      ["approve", "added"],
    ]);
    expect(diff.settings).toEqual([]);
  });

  it("pairs steps by ID at every depth: changed, unchanged, removed in place, and added", () => {
    const base = exampleSpec();
    const proposed = exampleSpec();
    proposed.steps = proposed.steps.filter((step) => step.id !== "prices");
    proposed.steps[2] = { ...proposed.steps[2], context: ["trigger.message"] };
    proposed.steps[1] = {
      ...proposed.steps[1],
      when: { step: "classify", label: "yes", minP: 0.6 },
    };
    proposed.steps.push({ id: "tell", type: "escalate", reason: "Check the reply." });
    proposed.credentials = "org";

    const diff = diffSpecs(parsed(base), parsed(proposed));

    expect(diff.steps.map((step) => [step.id, step.change])).toEqual([
      ["classify", "unchanged"],
      ["gate", "changed"],
      ["prices", "removed"],
      ["draft", "changed"],
      ["approve", "unchanged"],
      ["tell", "added"],
    ]);
    const gate = diff.steps.at(1);
    expect(gate?.before).toMatchObject({ paths: [{ condition: { checks: [{ minP: 0.85 }] } }] });
    expect(gate?.after).toMatchObject({ paths: [{ condition: { checks: [{ minP: 0.6 }] } }] });
    expect(diff.settings).toEqual(["credentials"]);
  });

  it("marks a branch changed for its own fields, not for a change to a step on its path", () => {
    const proposed = exampleSpec();
    proposed.steps[3] = { ...proposed.steps[3], context: ["trigger.message"] };

    const diff = diffSpecs(parsed(exampleSpec()), parsed(proposed));

    expect(diff.steps.map((step) => [step.id, step.change])).toEqual([
      ["classify", "unchanged"],
      ["gate", "unchanged"],
      ["prices", "unchanged"],
      ["draft", "changed"],
      ["approve", "unchanged"],
    ]);
  });

  it("ignores key order, as jsonb shuffles it", () => {
    const base = parsed(exampleSpec());
    const reversed = (value: object) => Object.fromEntries(Object.entries(value).reverse());
    const shuffled = { ...base, steps: base.steps.map((step) => reversed(step) as typeof step) };

    expect(diffSpecs(base, shuffled).steps.map((step) => step.change)).toEqual(
      Array.from({ length: 5 }, () => "unchanged"),
    );
  });
});
