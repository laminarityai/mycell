// Raw specs for builder tests, fresh per call.

/** Classify, then label the message: one Gmail action, internal-reversible. */
export function labelSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    specVersion: 1,
    id: "label-pricing",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    steps: [
      {
        id: "classify",
        type: "classify",
        role: "classify",
        question: "Is this a pricing inquiry?",
        labels: ["yes", "no"],
      },
      {
        id: "label",
        type: "tool",
        action: "google-mail.add-label",
        input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
      },
    ],
    autonomy: { rung: 3 },
    ...overrides,
  };
}
