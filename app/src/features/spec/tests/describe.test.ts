import { describe, expect, it } from "vitest";
import { describeSpec } from "../describe";
import type { Spec } from "../types";
import { validateSpec } from "../validate";
import { exampleSpec } from "./example-spec";

function parsed(input: unknown): Spec {
  const result = validateSpec(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.spec;
}

const ACTIONS: Record<string, { risk: string; description: string }> = {
  "google-sheet.read-range": {
    risk: "read",
    description: "Read a range of cells from a spreadsheet.",
  },
  "google-mail.create-draft": {
    risk: "external_send",
    description: "Write a reply to the triggering message as a draft in its thread.",
  },
};

describe("describeSpec", () => {
  it("says what each step does in plain words, with its action's risk level", () => {
    const steps = describeSpec(parsed(exampleSpec()), { action: (name) => ACTIONS[name] });

    expect(steps.map((step) => [step.id, step.text, step.risk])).toEqual([
      ["classify", 'Asks "Is this a pricing inquiry?" and picks one of: yes, no.', null],
      [
        "gate",
        'Goes on only if "classify" says "yes" with at least 85% confidence; otherwise stops.',
        null,
      ],
      ["prices", "Read a range of cells from a spreadsheet.", "read"],
      [
        "draft",
        'Write a reply to the triggering message as a draft in its thread: "Reply with our current prices."',
        "external_send",
      ],
      ["approve", "Waits for a person to review the Gmail drafts before they go anywhere.", null],
    ]);
  });

  it("marks the steps that wait for a review, and those the policy engine added", () => {
    const spec = parsed(exampleSpec());

    const steps = describeSpec(spec, { insertedApprovals: ["approve"] });

    expect(steps.find((step) => step.id === "approve")).toMatchObject({
      waitsForReview: true,
      requiredByPolicy: true,
    });
    expect(steps.find((step) => step.id === "draft")).toMatchObject({
      waitsForReview: false,
      requiredByPolicy: false,
    });
  });
});
