import type { Spec } from "@/features/spec/types";
import { validateSpec } from "@/features/spec/validate";

/** A spec that passed validation, built from raw JSON the way a saved spec is. */
export function parsedSpec(raw: unknown): Spec {
  const result = validateSpec(raw);
  if (!result.ok) throw new Error(`test spec is invalid: ${JSON.stringify(result.issues)}`);
  return result.spec;
}

const base = {
  specVersion: 1,
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  autonomy: { rung: 3 },
};

const classify = {
  id: "classify",
  type: "classify",
  role: "classify",
  question: "Is this a pricing inquiry?",
  labels: ["yes", "no"],
};

const gate = {
  id: "gate",
  type: "branch",
  when: { step: "classify", label: "yes", minP: 0.85 },
  else: "stop",
};

const draft = {
  id: "draft",
  type: "draft",
  role: "smart",
  instructions: "Reply with our current prices.",
  context: ["trigger.message", "prices"],
  output: "google-mail.create-draft",
};

/** The architecture's example: classify, branch, read a sheet, draft, approve. */
export function exampleSteps(): Record<string, unknown>[] {
  return [
    classify,
    gate,
    {
      id: "prices",
      type: "tool",
      action: "google-sheet.read-range",
      input: { spreadsheetId: "sheet-1", range: "Prices!A1:C50" },
    },
    draft,
    { id: "approve", type: "approval", channel: "gmail_drafts" },
  ];
}

export function specWithSteps(steps: Record<string, unknown>[]): Spec {
  return parsedSpec({ ...base, id: "test-spec", steps });
}

/** Classify, branch, then label the message: nothing leaves the company. */
export function labelOnlySpec(): Spec {
  return specWithSteps([
    classify,
    gate,
    {
      id: "label",
      type: "tool",
      action: "google-mail.add-label",
      input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
    },
  ]);
}
