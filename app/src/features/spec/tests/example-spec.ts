// The example spec from docs/architecture.md ("Workflow spec"), as a fresh object per call so
// a test can break one part of it.
export function exampleSpec() {
  return {
    specVersion: 1,
    id: "pricing-inquiry-replies",
    visibility: { tags: ["sales"] },
    credentials: "member",
    budget: { monthlyCredits: 500 },
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
        id: "prices",
        type: "tool",
        action: "google-sheet.read-range",
        input: { spreadsheetId: "sheet-1", range: "Prices!A1:C50" },
      },
      {
        id: "draft",
        type: "draft",
        role: "smart",
        instructions: "Reply with our current prices.",
        context: ["trigger.message", "prices"],
        output: "google-mail.create-draft",
      },
      { id: "approve", type: "approval", channel: "gmail_drafts" },
    ],
    autonomy: { rung: 3 },
  } as Record<string, unknown> & { steps: Record<string, unknown>[] };
}
