import { describe, expect, it } from "vitest";
import type { StoredSpec } from "../stored";
import { eachStep } from "../tree";
import type { Spec } from "../types";
import { upgradeSpec } from "../upgrade";
import { validateSpec } from "../validate";
import { exampleSpec } from "./example-spec";

/** A v1 fixture as a table would hold it: raw JSON, never re-parsed. */
const stored = (raw: unknown) => raw as StoredSpec;

const ids = (spec: Spec) => eachStep(spec).map(({ step }) => step.id);

function v1(steps: Record<string, unknown>[]) {
  return { ...exampleSpec(), steps };
}

const classify = {
  id: "classify",
  type: "classify",
  role: "classify",
  question: "Is this a pricing inquiry?",
  labels: ["yes", "no"],
};
const urgent = { ...classify, id: "urgent", question: "Is it urgent?" };
const gate = (id: string, step: string, otherwise: "stop" | "escalate" = "stop") => ({
  id,
  type: "branch",
  when: { step, label: "yes", minP: 0.85 },
  else: otherwise,
});
const label = (id: string) => ({
  id,
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
});

describe("upgradeSpec", () => {
  it("turns a v1 gate into a first-match branch whose one path holds every step after it", () => {
    const spec = upgradeSpec(stored(exampleSpec()));

    expect(spec.specVersion).toBe(2);
    expect(spec.steps.map((step) => step.id)).toEqual(["classify", "gate"]);
    expect(spec.steps[1]).toEqual({
      id: "gate",
      type: "branch",
      mode: "first",
      paths: [
        {
          id: "gate-yes",
          name: "yes",
          condition: {
            combine: "all",
            checks: [{ classify: "classify", is: "yes", minP: 0.85 }],
          },
          steps: exampleSpec().steps.slice(2),
        },
      ],
      otherwise: { id: "gate-otherwise", steps: [] },
    });
  });

  it("keeps everything but the steps as it was", () => {
    const upgraded = upgradeSpec(stored(exampleSpec()));

    expect({ ...upgraded, specVersion: 1, steps: [] }).toEqual({ ...exampleSpec(), steps: [] });
  });

  it("hands the message to a person on the otherwise path of a gate that escalated", () => {
    const spec = upgradeSpec(stored(v1([classify, gate("gate", "classify", "escalate")])));

    expect(spec.steps[1]).toMatchObject({
      paths: [{ steps: [] }],
      otherwise: {
        id: "gate-otherwise",
        steps: [
          {
            id: "gate-escalate",
            type: "escalate",
            reason: "The message didn't meet the branch's condition.",
          },
        ],
      },
    });
  });

  it("nests each later gate inside the path of the one before it, keeping every step ID", () => {
    const raw = v1([
      classify,
      gate("gate", "classify"),
      urgent,
      gate("rush", "urgent"),
      label("tag"),
    ]);

    const spec = upgradeSpec(stored(raw));

    expect(ids(spec)).toEqual(["classify", "gate", "urgent", "rush", "tag"]);
    expect(spec.steps[1]).toMatchObject({
      paths: [{ steps: [{ id: "urgent" }, { id: "rush", paths: [{ steps: [{ id: "tag" }] }] }] }],
    });
  });

  it("picks path and step IDs no step already has", () => {
    const raw = v1([
      classify,
      gate("gate", "classify", "escalate"),
      label("gate-yes"),
      label("gate-otherwise"),
      label("gate-escalate"),
    ]);

    const spec = upgradeSpec(stored(raw));

    expect(spec.steps[1]).toMatchObject({
      paths: [{ id: "gate-yes-2" }],
      otherwise: { id: "gate-otherwise-2", steps: [{ id: "gate-escalate-2" }] },
    });
    expect(validateSpec(spec)).toMatchObject({ ok: true });
  });

  it("names a path for its label, and gives one whose label makes no ID a plain one", () => {
    const labels = ["Pricing inquiry", "¿?"];
    const raw = v1([
      { ...classify, labels },
      {
        ...gate("gate", "classify"),
        when: { step: "classify", label: "Pricing inquiry", minP: 0.5 },
      },
      urgent,
      { ...gate("rush", "urgent"), when: { step: "urgent", label: "¿?", minP: 0.5 } },
    ]);
    raw.steps[2] = { ...urgent, labels };

    const spec = upgradeSpec(stored(raw));

    expect(spec.steps[1]).toMatchObject({
      paths: [{ id: "gate-pricing-inquiry", name: "Pricing inquiry" }],
    });
    expect(eachStep(spec).find(({ step }) => step.id === "rush")?.step).toMatchObject({
      paths: [{ id: "rush-path", name: "¿?" }],
    });
  });

  it("passes a v2 spec through, so upgrading twice changes nothing", () => {
    const once = upgradeSpec(stored(exampleSpec()));

    expect(upgradeSpec(once)).toBe(once);
    expect(upgradeSpec(stored(JSON.parse(JSON.stringify(once))))).toEqual(once);
  });

  it("upgrades every v1 fixture in this suite to a valid v2 spec with the same step IDs", () => {
    const fixtures = [
      exampleSpec(),
      v1([classify, gate("gate", "classify", "escalate")]),
      v1([classify, gate("gate", "classify"), urgent, gate("rush", "urgent"), label("tag")]),
      v1([classify, label("tag")]),
    ];
    for (const fixture of fixtures) {
      const spec = upgradeSpec(stored(fixture));
      const v1Ids = fixture.steps.map((step) => step.id);

      expect(validateSpec(spec)).toMatchObject({ ok: true });
      expect(ids(spec).filter((id) => v1Ids.includes(id))).toEqual(v1Ids);
      expect(upgradeSpec(spec)).toEqual(spec);
    }
  });
});
