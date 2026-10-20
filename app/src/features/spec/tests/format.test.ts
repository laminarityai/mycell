import { describe, expect, it } from "vitest";
import { formatSpec } from "../format";

describe("formatSpec", () => {
  it("writes a spec in reading order whatever order its keys came back in", () => {
    // As Postgres's jsonb hands a spec back: shorter keys first.
    const stored = {
      id: "quote-follow-ups",
      steps: [
        {
          id: "classify",
          role: "classify",
          type: "classify",
          labels: ["yes", "no"],
          question: "Q?",
        },
        { id: "gate", else: "stop", type: "branch", when: { minP: 0.85, step: "classify" } },
      ],
      trigger: { type: "gmail.message_received", labelIds: ["INBOX"] },
      autonomy: { rung: 3 },
      credentials: "member",
      specVersion: 1,
    };

    expect(formatSpec(stored)).toBe(
      `{
  "specVersion": 1,
  "id": "quote-follow-ups",
  "credentials": "member",
  "trigger": {
    "type": "gmail.message_received",
    "labelIds": [
      "INBOX"
    ]
  },
  "steps": [
    {
      "id": "classify",
      "type": "classify",
      "role": "classify",
      "labels": [
        "yes",
        "no"
      ],
      "question": "Q?"
    },
    {
      "id": "gate",
      "type": "branch",
      "else": "stop",
      "when": {
        "minP": 0.85,
        "step": "classify"
      }
    }
  ],
  "autonomy": {
    "rung": 3
  }
}`,
    );
  });

  it("puts keys it doesn't know after the ones it does, in their own order", () => {
    expect(formatSpec({ zeta: 1, steps: [], alpha: 2, id: "x" })).toBe(
      `{
  "id": "x",
  "steps": [],
  "zeta": 1,
  "alpha": 2
}`,
    );
  });
});
