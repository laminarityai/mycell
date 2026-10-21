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

/** Read the price sheet, then log the message to another: both Sheets actions. */
export function sheetSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...draftSpec(),
    id: "price-log",
    steps: [
      {
        id: "prices",
        type: "tool",
        action: "google-sheet.read-range",
        input: { spreadsheetId: "sheet-1", range: "Prices!A1:C50" },
      },
      {
        id: "log",
        type: "tool",
        action: "google-sheet.append-row",
        input: { spreadsheetId: "sheet-1", range: "Log!A:C", values: ["pricing"] },
      },
    ],
    ...overrides,
  };
}

/**
 * Sorts each message: complaints go to a person, pricing questions get a drafted reply (whose
 * approval the policy engine inserts on that path), and anything else stops.
 */
export function triageSpec(): Record<string, unknown> {
  const path = (id: string, name: string, is: string, steps: unknown[]) => ({
    id,
    name,
    condition: { combine: "all", checks: [{ classify: "kind", is, minP: 0.8 }] },
    steps,
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
        id: "route",
        type: "branch",
        mode: "first",
        paths: [
          path("complaint", "Complaint", "complaint", [
            { id: "to-person", type: "escalate", reason: "A person handles complaints." },
          ]),
          path("pricing", "Pricing", "pricing", [
            {
              id: "reply",
              type: "draft",
              role: "smart",
              instructions: "Reply with our current prices.",
              context: ["trigger.message"],
              output: "google-mail.create-draft",
            },
          ]),
        ],
        otherwise: { id: "rest", steps: [] },
      },
    ],
    autonomy: { rung: 3 },
  };
}
