import { describe, expect, it } from "vitest";
import { eachStep, findStep } from "@/features/spec/tree";
import { upgradeSpec } from "@/features/spec/upgrade";
import { actionsAllowedBy, catalog, catalogActionSet } from "../catalog";
import { googleScope } from "@/lib/google";
import { applyPolicy, maxRisk } from "../engine";
import { exampleSteps, labelOnlySpec, specWithSteps } from "./specs";

/** Where a step after the gate sits: on the path its gate became, at `index`. */
const onGatePath = (index: number, ...field: string[]) => [
  "steps",
  1,
  "paths",
  0,
  "steps",
  index,
  ...field,
];

describe("this suite's v1 fixtures", () => {
  it("each upgrade to a valid v2 spec with the same step IDs, and once is enough", () => {
    const steps = exampleSteps();
    for (const [spec, ids] of [
      [specWithSteps(steps), steps.map((step) => step.id)],
      [labelOnlySpec(), ["classify", "gate", "label"]],
    ] as const) {
      expect(spec.specVersion).toBe(2);
      expect(eachStep(spec).map(({ step }) => step.id)).toEqual(ids);
      expect(upgradeSpec(spec)).toBe(spec);
    }
  });
});

describe("the catalog", () => {
  it("lists the actions a connection's granted scopes allow", () => {
    const names = (scopes: string[]) => actionsAllowedBy(scopes).map((action) => action.name);

    expect(names([googleScope("gmail.readonly")])).toEqual([
      "google-mail.read-message",
      "google-mail.read-thread",
    ]);
    expect(names([googleScope("gmail.modify"), googleScope("spreadsheets.readonly")])).toEqual([
      "google-mail.read-message",
      "google-mail.read-thread",
      "google-mail.add-label",
      "google-mail.create-draft",
      "google-sheet.read-range",
    ]);
    expect(names([])).toEqual([]);
  });

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

  it("names the pending form of every external send, and of nothing else (ADR-0013)", () => {
    const forms = Object.values(catalog).map((action) => [action.risk, action.pendingForm]);

    for (const [risk, form] of forms) {
      expect(form === undefined).toBe(risk !== "external_send");
    }
    expect(catalog["google-mail.create-draft"].pendingForm).toBe("a Gmail draft");
  });
});

describe("maxRisk", () => {
  it("is external_send for the architecture's example, which drafts a reply", () => {
    expect(maxRisk(specWithSteps(exampleSteps()), catalogActionSet)).toBe("external_send");
  });

  it("is internal_reversible for a spec that only labels messages", () => {
    expect(maxRisk(labelOnlySpec(), catalogActionSet)).toBe("internal_reversible");
  });

  it("ignores a risk level the spec claims for an action", () => {
    const steps = exampleSteps();
    steps[3] = { ...steps[3], risk: "read" };

    expect(maxRisk(specWithSteps(steps), catalogActionSet)).toBe("external_send");
  });
});

describe("applyPolicy", () => {
  it("leaves a spec that already approves its draft unchanged", () => {
    const spec = specWithSteps(exampleSteps());

    expect(applyPolicy(spec, catalogActionSet)).toEqual({
      ok: true,
      spec,
      maxRisk: "external_send",
      inserted: [],
    });
  });

  it("inserts an approval right after a draft that has none, and reports it", () => {
    const result = applyPolicy(specWithSteps(exampleSteps().slice(0, 4)), catalogActionSet);

    expect(result).toMatchObject({
      ok: true,
      inserted: [{ stepId: "draft-approval", after: "draft", action: "google-mail.create-draft" }],
    });
    if (!result.ok) return;
    expect(eachStep(result.spec).map(({ step }) => step.id)).toEqual([
      "classify",
      "gate",
      "prices",
      "draft",
      "draft-approval",
    ]);
    expect(findStep(result.spec, "draft-approval")).toEqual({
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

    const result = applyPolicy(specWithSteps(steps), catalogActionSet);

    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          path: onGatePath(0, "action"),
          message: expect.stringContaining("delete-sheet") as string,
        },
        { path: onGatePath(1, "output") },
        { path: onGatePath(3, "action") },
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

    const result = applyPolicy(specWithSteps(steps), catalogActionSet);

    expect(result).toMatchObject({ ok: true, inserted: [{ stepId: "draft-approval-2" }] });
  });

  it("refuses a Sheets range that doesn't name its sheet, at the input's path", () => {
    const steps = exampleSteps();
    steps[2] = { ...steps[2], input: { spreadsheetId: "sheet-1", range: "A1:C50" } };
    steps.push({
      id: "log",
      type: "tool",
      action: "google-sheet.append-row",
      input: { spreadsheetId: "sheet-1", range: "A:C", values: ["pricing"] },
    });

    const result = applyPolicy(specWithSteps(steps), catalogActionSet);

    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          path: onGatePath(0, "input", "range"),
          message: expect.stringContaining("Sheet1!A:C") as string,
        },
        { path: onGatePath(3, "input", "range") },
      ],
    });
  });

  it("leaves a range given by a reference to the run", () => {
    const steps = exampleSteps();
    steps[2] = {
      ...steps[2],
      input: { spreadsheetId: "sheet-1", range: { from: "classify.label" } },
    };

    expect(applyPolicy(specWithSteps(steps), catalogActionSet)).toMatchObject({ ok: true });
  });
});
