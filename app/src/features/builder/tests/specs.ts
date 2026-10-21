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

/** Classify, then draft a reply: the draft has no approval, so the policy engine inserts one. */
export function draftSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    specVersion: 1,
    id: "pricing-replies",
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
        id: "gate",
        type: "branch",
        when: { step: "classify", label: "yes", minP: 0.85 },
        else: "stop",
      },
      {
        id: "reply",
        type: "draft",
        role: "smart",
        instructions: "Reply with our current prices.",
        context: ["trigger.message"],
        output: "google-mail.create-draft",
      },
    ],
    autonomy: { rung: 3 },
    ...overrides,
  };
}
