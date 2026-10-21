// A v2 spec with a first-match branch of several paths, as a fresh object per call so a test
// can break one part of it: complaints go to a person, pricing questions get a drafted reply,
// and anything else stops.
export function triageSpec() {
  return {
    specVersion: 2,
    id: "triage",
    credentials: "member",
    trigger: { type: "gmail.message_received", labelIds: ["INBOX"] },
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
          total: { type: "number", description: "The order total" },
          product: { type: "string", description: "What they ask about" },
          urgent: { type: "boolean", description: "Whether they say it's urgent" },
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
            condition: {
              combine: "all",
              checks: [{ classify: "kind", is: "complaint", minP: 0.8 }],
            },
            steps: [{ id: "to-person", type: "escalate", reason: "A person handles complaints." }],
          },
          {
            id: "pricing",
            name: "Pricing",
            condition: {
              combine: "any",
              checks: [
                { classify: "kind", is: "pricing", minP: 0.85 },
                { subject: { from: "details.product" }, op: "contains", value: "Chair" },
              ],
            },
            steps: [
              {
                id: "reply",
                type: "draft",
                role: "smart",
                instructions: "Reply with our current prices.",
                context: ["trigger.message", "details"],
                output: "google-mail.create-draft",
              },
            ],
          },
        ],
        otherwise: { id: "rest", steps: [] },
      },
    ],
    autonomy: { rung: 3 },
  } as Record<string, unknown> & { steps: Record<string, unknown>[] };
}

/** A path with these checks, all of which must hold, and these steps. */
export function pathOf(id: string, checks: unknown[], steps: unknown[] = []) {
  return { id, name: id, condition: { combine: "all", checks }, steps };
}

/** The triage spec with the branch's paths replaced. */
export function triageWithPaths(paths: unknown[]) {
  const spec = triageSpec();
  spec.steps[2] = { ...spec.steps[2], paths };
  return spec;
}
