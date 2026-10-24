import { describe, expect, it } from "vitest";
import { describePathTo, describeSpec } from "../describe";
import type { Spec } from "../types";
import { validateSpec } from "../validate";
import { exampleSpec } from "./example-spec";
import { pathOf, triageSpec } from "./triage-spec";

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

  it("says in plain words that an every-match branch runs each path that applies", () => {
    const spec = triageSpec();
    spec.steps[2] = {
      ...spec.steps[2],
      mode: "every",
      paths: [
        pathOf("urgent", [{ subject: { from: "details.urgent" }, op: "is_yes" }]),
        pathOf("pricing", [{ classify: "kind", is: "pricing", minP: 0.85 }]),
      ],
    };

    const route = describeSpec(parsed(spec)).find((step) => step.id === "route");

    expect(route?.text).toBe(
      `Every match: runs each path that applies, one after another, left to right: "urgent" if whether they say it's urgent is yes; "pricing" if "kind" says "pricing" with at least 85% confidence; if none applies, stops.`,
    );
  });

  it("names what each check tests in plain words, never as a reference", () => {
    const spec = triageSpec();
    spec.steps.splice(2, 0, {
      id: "thread",
      type: "tool",
      action: "google-mail.read-thread",
      input: { threadId: { from: "trigger.threadId" } },
    });
    spec.steps[3] = {
      ...spec.steps[3],
      paths: [
        pathOf("big", [
          { subject: { from: "details.total" }, op: "more_than", value: 1000 },
          { subject: { from: "trigger.senderDomain" }, op: "is", value: "acme.test" },
          { subject: { from: "thread.messageCount" }, op: "at_least", value: 3 },
        ]),
      ],
    };
    const action = (name: string) =>
      name === "google-mail.read-thread"
        ? {
            risk: "read",
            description: "Read the thread a message belongs to.",
            conditionFields: [
              { name: "messageCount", type: "number" as const, label: "The number of messages" },
            ],
          }
        : undefined;

    const route = describeSpec(parsed(spec), { action }).find((step) => step.id === "route");

    expect(route?.text).toBe(
      'Goes on only if the order total is more than 1000 and the sender\'s domain is "acme.test" and the number of messages is at least 3; otherwise stops.',
    );
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

  it("says an approval of suggested edits waits for them to be accepted or rejected", () => {
    const spec = exampleSpec();
    spec.steps[4] = { id: "approve", type: "approval", channel: "suggested_edits" };

    const steps = describeSpec(parsed(spec), {});

    expect(steps.find((step) => step.id === "approve")?.text).toBe(
      "Waits for a person to accept or reject the suggested edits before the doc changes.",
    );
  });
});

describe("describePathTo", () => {
  it("names a step's path after the paths it's nested in, an otherwise path as Otherwise", () => {
    const spec = triageSpec();
    spec.steps[2] = {
      ...spec.steps[2],
      paths: [
        pathOf(
          "pricing",
          [{ classify: "kind", is: "pricing", minP: 0.8 }],
          [
            {
              id: "size",
              type: "branch",
              paths: [pathOf("huge", [{ classify: "kind", is: "pricing", minP: 0.9 }])],
              otherwise: {
                id: "small",
                steps: [{ id: "look", type: "escalate", reason: "Look." }],
              },
            },
          ],
        ),
      ],
    };
    const parsedSpec = parsed(spec);

    expect(describePathTo(parsedSpec, "look")).toBe("pricing › Otherwise");
    expect(describePathTo(parsedSpec, "size")).toBe("pricing");
    expect(describePathTo(parsedSpec, "kind")).toBeNull();
  });
});
