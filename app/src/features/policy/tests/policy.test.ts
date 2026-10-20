import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { applyPolicy, maxRisk } from "../engine";
import { exampleSteps, labelOnlySpec, specWithSteps } from "./specs";

describe("the catalog", () => {
  it("holds v1's six actions at their fixed risk levels", () => {
    const levels = Object.fromEntries(
      Object.values(catalog).map((action) => [action.name, action.risk]),
    );

    expect(levels).toEqual({
      "google-mail.read-message": "read",
      "google-mail.read-thread": "read",
      "google-mail.add-label": "internal_reversible",
      "google-mail.create-draft": "external_send",
      "google-sheet.read-range": "read",
      "google-sheet.append-row": "internal_reversible",
    });
  });
});

describe("maxRisk", () => {
  it("is external_send for the architecture's example, which drafts a reply", () => {
    expect(maxRisk(specWithSteps(exampleSteps()))).toBe("external_send");
  });

  it("is internal_reversible for a spec that only labels messages", () => {
    expect(maxRisk(labelOnlySpec())).toBe("internal_reversible");
  });

  it("ignores a risk level the spec claims for an action", () => {
    const steps = exampleSteps();
    steps[3] = { ...steps[3], risk: "read" };

    expect(maxRisk(specWithSteps(steps))).toBe("external_send");
  });
});

describe("applyPolicy", () => {
  it("leaves a spec that already approves its draft unchanged", () => {
    const spec = specWithSteps(exampleSteps());

    expect(applyPolicy(spec)).toEqual({ ok: true, spec, maxRisk: "external_send", inserted: [] });
  });

  it("inserts an approval right after a draft that has none, and reports it", () => {
    const result = applyPolicy(specWithSteps(exampleSteps().slice(0, 4)));

    expect(result).toMatchObject({
      ok: true,
      inserted: [{ stepId: "draft-approval", after: "draft", action: "google-mail.create-draft" }],
    });
    if (!result.ok) return;
    expect(result.spec.steps.map((step) => step.id)).toEqual([
      "classify",
      "gate",
      "prices",
      "draft",
      "draft-approval",
    ]);
    expect(result.spec.steps[4]).toEqual({
      id: "draft-approval",
      type: "approval",
      channel: "gmail_drafts",
    });
  });

  it("refuses unknown actions and actions used where their risk doesn't allow, all at once", () => {
    const steps = exampleSteps();
    steps[2] = { ...steps[2], action: "google-sheet.delete-sheet" };
    steps[3] = { ...steps[3], output: "google-mail.add-label" };
    steps.push({
      id: "send",
      type: "tool",
      action: "google-mail.create-draft",
      input: { messageId: { from: "trigger.messageId" } },
    });

    const result = applyPolicy(specWithSteps(steps));

    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          path: ["steps", 2, "action"],
          message: expect.stringContaining("delete-sheet") as string,
        },
        { path: ["steps", 3, "output"] },
        { path: ["steps", 5, "action"] },
      ],
    });
  });

  it("names the inserted approval so it doesn't clash with an existing step", () => {
    const steps = exampleSteps().slice(0, 4);
    steps.splice(3, 0, {
      id: "draft-approval",
      type: "escalate",
      reason: "never reached",
    });

    const result = applyPolicy(specWithSteps(steps));

    expect(result).toMatchObject({ ok: true, inserted: [{ stepId: "draft-approval-2" }] });
  });
});
