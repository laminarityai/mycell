// PROTOTYPE, throwaway: the two workflows' specs the run page draws, as their versions hold them
// (the policy engine adds the review after the draft when the graph draws them).
import type { Spec } from "@/features/spec/types";

const TRIGGER = { type: "gmail.message_received", labelIds: ["INBOX"] } as const;

/** "Reply to quote requests", version 7. */
export const QUOTES_SPEC: Spec = {
  specVersion: 2,
  id: "reply-to-quote-requests",
  credentials: "member",
  trigger: { ...TRIGGER, labelIds: [...TRIGGER.labelIds] },
  autonomy: { rung: 3 },
  budget: { monthlyCredits: 2000 },
  steps: [
    {
      id: "kind",
      type: "classify",
      role: "classify",
      question: "Is this a request for a quote?",
      labels: ["quote", "other"],
      checks: { minP: 0.8 },
    },
    {
      id: "route",
      type: "branch",
      mode: "first",
      paths: [
        {
          id: "quote",
          name: "Quote request",
          condition: { combine: "all", checks: [{ classify: "kind", is: "quote", minP: 0.8 }] },
          steps: [
            {
              id: "details",
              type: "extract",
              role: "fast",
              fields: {
                product: { type: "string", description: "What they want a price for" },
                quantity: { type: "number", description: "How many they want" },
              },
              checks: { requiredFields: ["product", "quantity"] },
            },
            {
              id: "lookup-price",
              type: "tool",
              action: "google-sheet.read-range",
              input: { spreadsheetId: "price-sheet", range: "Prices!A1:C200" },
            },
            {
              id: "reply",
              type: "draft",
              role: "smart",
              instructions: "Reply with a quote from the price sheet, in our usual tone.",
              context: ["trigger.message", "details", "lookup-price"],
              output: "google-mail.create-draft",
            },
          ],
        },
      ],
      otherwise: { id: "not-a-quote", steps: [] },
    },
  ],
};

/** "Follow-up tasks from orders", version 5. */
export const FOLLOWUPS_SPEC: Spec = {
  specVersion: 2,
  id: "follow-up-tasks-from-orders",
  credentials: "member",
  trigger: { ...TRIGGER, labelIds: [...TRIGGER.labelIds] },
  autonomy: { rung: 3 },
  steps: [
    {
      id: "is-order",
      type: "classify",
      role: "classify",
      question: "Is this an order confirmation?",
      labels: ["order", "other"],
      checks: { minP: 0.8 },
    },
    {
      id: "route",
      type: "branch",
      mode: "first",
      paths: [
        {
          id: "order",
          name: "Order",
          condition: {
            combine: "all",
            checks: [{ classify: "is-order", is: "order", minP: 0.8 }],
          },
          steps: [
            {
              id: "extract-order",
              type: "extract",
              role: "fast",
              fields: {
                order_number: { type: "string", description: "The order number" },
                customer: { type: "string", description: "Who placed the order" },
                due_date: { type: "string", description: "When it has to ship" },
              },
              checks: {
                schema: {
                  type: "object",
                  required: ["order_number"],
                  properties: { order_number: { type: "string", minLength: 1 } },
                },
                requiredFields: ["order_number", "customer"],
              },
            },
            {
              id: "add-followup",
              type: "tool",
              action: "google-sheet.append-row",
              input: {
                spreadsheetId: "follow-ups",
                range: "Follow-ups!A:D",
                values: [
                  { from: "extract-order.order_number" },
                  { from: "extract-order.customer" },
                  { from: "extract-order.due_date" },
                ],
              },
            },
          ],
        },
      ],
      otherwise: { id: "not-an-order", steps: [] },
    },
  ],
};
