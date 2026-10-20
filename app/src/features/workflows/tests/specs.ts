// Raw specs as an admin pastes them, fresh per call so a test can break one part.

/** Classify, branch, then draft a reply: the draft has no approval, so one is inserted. */
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

/** Classify, then label the message: internal-reversible, nothing inserted. */
export function labelSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...draftSpec(),
    id: "label-pricing",
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
    ...overrides,
  };
}
