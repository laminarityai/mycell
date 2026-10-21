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

/**
 * Classify the kind and extract the order, then a first-match branch: complaints to a person,
 * pricing questions labelled, big walnut orders labelled, and otherwise nothing.
 */
export function triageSpec(): Record<string, unknown> {
  const label = (id: string, name: string) => ({
    id,
    type: "tool",
    action: "google-mail.add-label",
    input: { messageId: { from: "trigger.messageId" }, label: name },
  });
  const isKind = (is: string) => ({
    combine: "all",
    checks: [{ classify: "kind", is, minP: 0.8 }],
  });
  return {
    specVersion: 2,
    id: "triage",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    steps: [
      {
        id: "kind",
        type: "classify",
        role: "classify",
        question: "What kind of message is this?",
        labels: ["complaint", "pricing", "other"],
      },
      {
        id: "details",
        type: "extract",
        role: "fast",
        fields: {
          product: { type: "string", description: "What they ask about" },
          total: { type: "number", description: "The order total" },
        },
      },
      {
        id: "route",
        type: "branch",
        mode: "first",
        paths: [
          {
            id: "complaint",
            name: "Complaint",
            condition: isKind("complaint"),
            steps: [{ id: "to-person", type: "escalate", reason: "A person handles complaints." }],
          },
          {
            id: "pricing",
            name: "Pricing",
            condition: isKind("pricing"),
            steps: [label("pricing-label", "Pricing")],
          },
          {
            id: "big",
            name: "Big order",
            condition: {
              combine: "all",
              checks: [
                { subject: { from: "details.product" }, op: "contains", value: "walnut" },
                { subject: { from: "details.total" }, op: "more_than", value: 1000 },
              ],
            },
            steps: [label("big-label", "Big order")],
          },
        ],
        otherwise: { id: "rest", steps: [] },
      },
    ],
    autonomy: { rung: 3 },
  };
}
