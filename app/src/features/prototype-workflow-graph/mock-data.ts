// PROTOTYPE, never merge. Every variant renders these same specs, proposals, chats and sample
// messages. Nothing is read from the database or a model.
import type { ChatMessage, MockProposal, SampleMessage, ShapeId, SpecV2, Step } from "./types";

const trigger = { type: "gmail.message_received" as const, labelIds: ["INBOX"] };

const sortStep: Step = {
  id: "sort",
  type: "classify",
  role: "classify",
  question: "What is this email about?",
  labels: ["pricing", "complaint", "other"],
};

// 1. Sorting (first match) ---------------------------------------------------------------------

const sortingSpec: SpecV2 = {
  specVersion: 2,
  id: "sort-sales-inbox",
  name: "Sort the sales inbox",
  credentials: "org",
  trigger,
  steps: [
    sortStep,
    {
      id: "route",
      type: "branch",
      mode: "first",
      paths: [
        {
          id: "pricing",
          name: "Pricing question",
          condition: {
            combine: "all",
            checks: [{ kind: "classify", step: "sort", label: "pricing", minP: 0.85 }],
          },
          steps: [
            {
              id: "read-thread",
              type: "tool",
              action: "google-mail.read-thread",
              input: { threadId: "trigger.threadId" },
            },
            {
              id: "reply",
              type: "draft",
              role: "smart",
              instructions: "Answer with prices from our price sheet. Keep it under 120 words.",
              context: ["trigger.message", "read-thread"],
              output: "google-mail.create-draft",
            },
          ],
        },
        {
          id: "complaint",
          name: "Complaint",
          condition: {
            combine: "all",
            checks: [{ kind: "classify", step: "sort", label: "complaint", minP: 0.7 }],
          },
          steps: [
            {
              id: "to-person",
              type: "escalate",
              reason: "A customer is unhappy; someone on the team should answer personally.",
            },
          ],
        },
      ],
      otherwise: { id: "route-otherwise", steps: [] },
    },
  ],
};

const sortingProposalSpec: SpecV2 = structuredClone(sortingSpec);
{
  const route = sortingProposalSpec.steps[1];
  if (route.type === "branch") {
    const [pricing, complaint] = route.paths;
    // Removed: the thread read. Changed: the draft's instructions.
    pricing.steps = [
      {
        id: "reply",
        type: "draft",
        role: "smart",
        instructions:
          "Answer with prices from our price sheet, and offer a call for orders over 50 seats. Keep it under 120 words.",
        context: ["trigger.message"],
        output: "google-mail.create-draft",
      },
    ];
    // Changed condition: also any message whose subject mentions a refund.
    complaint.condition = {
      combine: "any",
      checks: [
        { kind: "classify", step: "sort", label: "complaint", minP: 0.7 },
        { kind: "fact", fact: "subject", op: "contains", value: "refund" },
      ],
    };
    // Added: a label before the hand-off.
    complaint.steps = [
      {
        id: "label-complaint",
        type: "tool",
        action: "google-mail.add-label",
        input: { messageId: "trigger.messageId", label: "Complaints" },
      },
      ...complaint.steps,
    ];
  }
}

// 2. Every match --------------------------------------------------------------------------------

const everySpec: SpecV2 = {
  specVersion: 2,
  id: "urgent-and-invoices",
  name: "Urgent mail and invoices",
  credentials: "org",
  trigger,
  steps: [
    {
      id: "read-message",
      type: "tool",
      action: "google-mail.read-message",
      input: { messageId: "trigger.messageId" },
    },
    {
      id: "read-fields",
      type: "extract",
      role: "fast",
      fields: [
        { name: "urgent", type: "boolean", description: "Does the sender need an answer today?" },
        {
          name: "invoiceNumber",
          type: "string",
          description: "The invoice number, if the message mentions one.",
        },
      ],
    },
    {
      id: "split",
      type: "branch",
      mode: "every",
      paths: [
        {
          id: "urgent",
          name: "Urgent",
          condition: {
            combine: "any",
            checks: [
              { kind: "value", step: "read-fields", field: "urgent", op: "is", value: "yes" },
              { kind: "fact", fact: "subject", op: "contains", value: "urgent" },
            ],
          },
          steps: [
            {
              id: "add-task",
              type: "tool",
              action: "google-tasks.create-task",
              input: { list: "Inbox follow-ups", title: "Answer {{trigger.subject}} today" },
            },
          ],
        },
        {
          id: "has-invoice",
          name: "Has an invoice number",
          condition: {
            combine: "all",
            checks: [
              {
                kind: "value",
                step: "read-fields",
                field: "invoiceNumber",
                op: "filled",
                value: "",
              },
            ],
          },
          steps: [
            {
              id: "find-invoice",
              type: "tool",
              action: "google-sheet.read-range",
              input: { spreadsheetId: "Invoices 2026", range: "Invoices!A:F" },
            },
            {
              id: "log-invoice",
              type: "tool",
              action: "google-sheet.append-row",
              input: {
                spreadsheetId: "Invoices 2026",
                range: "Follow-ups!A:D",
                values: "{{read-fields.invoiceNumber}}, {{trigger.from}}, {{trigger.date}}",
              },
            },
          ],
        },
      ],
      otherwise: { id: "split-otherwise", steps: [] },
    },
  ],
};

const everyProposalSpec: SpecV2 = structuredClone(everySpec);
{
  // Removed: the message read nobody uses.
  everyProposalSpec.steps = everyProposalSpec.steps.filter((step) => step.id !== "read-message");
  const split = everyProposalSpec.steps.at(-1);
  if (split?.type === "branch") {
    const [urgent, invoice] = split.paths;
    // Added: label urgent mail.
    urgent.steps.push({
      id: "label-urgent",
      type: "tool",
      action: "google-mail.add-label",
      input: { messageId: "trigger.messageId", label: "Urgent" },
    });
    // Changed: the log goes to the Overdue tab.
    const log = invoice.steps[1];
    if (log.type === "tool") log.input = { ...log.input, range: "Overdue!A:D" };
  }
}

// 3. Nested two deep ----------------------------------------------------------------------------

const nestedSpec: SpecV2 = {
  specVersion: 2,
  id: "quote-or-hand-off",
  name: "Quote or hand off",
  credentials: "org",
  trigger,
  steps: [
    sortStep,
    {
      id: "route",
      type: "branch",
      mode: "first",
      paths: [
        {
          id: "pricing",
          name: "Pricing question",
          condition: {
            combine: "all",
            checks: [{ kind: "classify", step: "sort", label: "pricing", minP: 0.85 }],
          },
          steps: [
            {
              id: "order",
              type: "extract",
              role: "fast",
              fields: [
                {
                  name: "orderTotal",
                  type: "number",
                  description: "The order's total in dollars.",
                },
                { name: "product", type: "string", description: "Which plan they ask about." },
              ],
            },
            {
              id: "size",
              type: "branch",
              mode: "first",
              paths: [
                {
                  id: "large",
                  name: "Large order",
                  condition: {
                    combine: "all",
                    checks: [
                      {
                        kind: "value",
                        step: "order",
                        field: "orderTotal",
                        op: "more_than",
                        value: "1000",
                      },
                    ],
                  },
                  steps: [
                    {
                      id: "big-order",
                      type: "escalate",
                      reason: "Orders over $1,000 need a person to quote them.",
                    },
                  ],
                },
              ],
              otherwise: {
                id: "size-otherwise",
                steps: [
                  {
                    id: "small-thread",
                    type: "tool",
                    action: "google-mail.read-thread",
                    input: { threadId: "trigger.threadId" },
                  },
                  {
                    id: "reply-small",
                    type: "draft",
                    role: "smart",
                    instructions:
                      "Quote the price from the price sheet and offer to place the order.",
                    context: ["trigger.message", "order"],
                    output: "google-mail.create-draft",
                  },
                ],
              },
            },
          ],
        },
        {
          id: "complaint",
          name: "Complaint",
          condition: {
            combine: "all",
            checks: [{ kind: "classify", step: "sort", label: "complaint", minP: 0.7 }],
          },
          steps: [
            {
              id: "complaint-person",
              type: "escalate",
              reason: "A customer is unhappy; someone should answer personally.",
            },
          ],
        },
      ],
      otherwise: { id: "route-otherwise", steps: [] },
    },
  ],
};

const nestedProposalSpec: SpecV2 = structuredClone(nestedSpec);
{
  const route = nestedProposalSpec.steps[1];
  if (route.type === "branch") {
    const pricing = route.paths[0];
    // Added: look the customer up before deciding.
    pricing.steps.splice(1, 0, {
      id: "lookup-customer",
      type: "tool",
      action: "google-sheet.read-range",
      input: { spreadsheetId: "Customers", range: "Customers!A:D" },
    });
    const size = pricing.steps[2];
    if (size.type === "branch") {
      // Changed: 2,000, or a customer the sheet doesn't know.
      size.paths[0].condition = {
        combine: "any",
        checks: [
          { kind: "value", step: "order", field: "orderTotal", op: "more_than", value: "2000" },
          { kind: "tool", step: "lookup-customer", field: "rowCount", op: "is", value: "0" },
        ],
      };
      // Removed: the thread read.
      size.otherwise.steps = size.otherwise.steps.filter((step) => step.id !== "small-thread");
    }
    // Added: the otherwise path now labels the message instead of stopping.
    route.otherwise.steps = [
      {
        id: "label-other",
        type: "tool",
        action: "google-mail.add-label",
        input: { messageId: "trigger.messageId", label: "Mycel/other" },
      },
    ];
  }
}

// Shapes ----------------------------------------------------------------------------------------

export const SHAPES: { id: ShapeId; label: string }[] = [
  { id: "sorting", label: "Sorting (first match)" },
  { id: "every", label: "Every match" },
  { id: "nested", label: "Nested two deep" },
  { id: "empty", label: "No workflow yet" },
];

export const INITIAL_SPECS: Record<ShapeId, SpecV2 | null> = {
  sorting: sortingSpec,
  every: everySpec,
  nested: nestedSpec,
  empty: null,
};

export const INITIAL_PROPOSALS: Record<ShapeId, MockProposal> = {
  sorting: {
    base: sortingSpec,
    name: sortingSpec.name,
    summary:
      "Labels complaints before handing them over, also catches refund requests, and drafts pricing replies without reading the whole thread.",
    spec: sortingProposalSpec,
    status: "proposed",
  },
  every: {
    base: everySpec,
    name: everySpec.name,
    summary:
      "Labels urgent mail as well as adding a task, logs invoices to the Overdue tab, and drops the message read nothing used.",
    spec: everyProposalSpec,
    status: "proposed",
  },
  nested: {
    base: nestedSpec,
    name: nestedSpec.name,
    summary:
      "Looks the customer up first, hands over orders above $2,000 or from customers we don't know, and labels everything that isn't pricing or a complaint.",
    spec: nestedProposalSpec,
    status: "proposed",
  },
  empty: {
    base: null,
    name: sortingSpec.name,
    summary:
      "Sorts each new message in the sales inbox: drafts a reply to pricing questions for review, hands complaints to a person, and leaves everything else alone.",
    spec: sortingSpec,
    status: "proposed",
  },
};

export const CHATS: Record<ShapeId, ChatMessage[]> = {
  sorting: [
    {
      id: "u1",
      role: "user",
      text: "When someone asks about pricing, draft a reply from our price sheet. Complaints should go to a person.",
    },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "tool", label: "Read example messages" },
        {
          type: "text",
          text: "I read 20 recent messages in sales@: 7 asked about pricing and 3 were complaints. You accepted a workflow that sorts each new message into those two paths.",
        },
      ],
    },
    {
      id: "u2",
      role: "user",
      text: "Label complaints too, and catch refund requests even if the model isn't sure. The thread read seems unnecessary.",
    },
    {
      id: "a2",
      role: "assistant",
      parts: [
        { type: "tool", label: "Read a workflow" },
        { type: "text", text: "Here's the change. The pricing reply still waits for your review." },
        { type: "proposal" },
      ],
    },
  ],
  every: [
    {
      id: "u1",
      role: "user",
      text: "Anything urgent should become a task. If a message has an invoice number, look it up and log it in the follow-ups sheet. Both can happen.",
    },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "tool", label: "Read example messages" },
        {
          type: "text",
          text: "Since both can apply to one message, this branch runs every path that matches, left to right.",
        },
      ],
    },
    {
      id: "u2",
      role: "user",
      text: "Also label urgent ones, and log invoices to the Overdue tab.",
    },
    {
      id: "a2",
      role: "assistant",
      parts: [
        { type: "text", text: "Done. I also dropped a step nothing used." },
        { type: "proposal" },
      ],
    },
  ],
  nested: [
    {
      id: "u1",
      role: "user",
      text: "For pricing questions, quote small orders myself but send anything over $1,000 to a person.",
    },
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "The pricing path now reads the order total and splits again: over $1,000 goes to a person, anything else gets a drafted quote.",
        },
      ],
    },
    {
      id: "u2",
      role: "user",
      text: "Raise that to $2,000, but also hand over customers we've never seen. And label the leftovers.",
    },
    {
      id: "a2",
      role: "assistant",
      parts: [
        { type: "tool", label: "Read a workflow" },
        { type: "text", text: "Here's the change." },
        { type: "proposal" },
      ],
    },
  ],
  empty: [
    {
      id: "u1",
      role: "user",
      text: "When someone asks about pricing, draft a reply from our price sheet. Complaints should go to a person.",
    },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "tool", label: "Read example messages" },
        {
          type: "text",
          text: "I read 20 recent messages in sales@: 7 asked about pricing and 3 were complaints. Here's a workflow that sorts each new one.",
        },
        { type: "proposal" },
      ],
    },
  ],
};

// Try it ----------------------------------------------------------------------------------------

const SAMPLES: Record<string, SampleMessage> = {
  dana: {
    id: "dana",
    from: "dana@northwind.example",
    subject: "Pricing for 40 seats?",
    snippet: "We're looking at the Team plan for about 40 people. What would that cost per year?",
    facts: {
      sender_domain: "northwind.example",
      subject: "Pricing for 40 seats?",
      has_attachment: "no",
      is_reply: "no",
    },
    classify: { sort: { label: "pricing", p: 0.93 } },
    extract: {
      "read-fields": { urgent: "no", invoiceNumber: "" },
      order: { orderTotal: "1450", product: "Team plan" },
    },
    tool: { "lookup-customer": { rowCount: "1" }, "find-invoice": { rowCount: "0" } },
  },
  ops: {
    id: "ops",
    from: "ops@brightlane.example",
    subject: "INV-2207 charged twice, please refund",
    snippet: "We were charged twice for invoice INV-2207. We need this fixed today.",
    facts: {
      sender_domain: "brightlane.example",
      subject: "INV-2207 charged twice, please refund",
      has_attachment: "yes",
      is_reply: "no",
    },
    classify: { sort: { label: "complaint", p: 0.81 } },
    extract: {
      "read-fields": { urgent: "yes", invoiceNumber: "INV-2207" },
      order: { orderTotal: "0", product: "" },
    },
    tool: { "lookup-customer": { rowCount: "1" }, "find-invoice": { rowCount: "1" } },
  },
  sam: {
    id: "sam",
    from: "sam@gmail.com",
    subject: "Quick question, can you reply today?",
    snippet: "Is the starter plan billed monthly? Sorry for the rush, I need to decide today.",
    facts: {
      sender_domain: "gmail.com",
      subject: "Quick question, can you reply today?",
      has_attachment: "no",
      is_reply: "no",
    },
    classify: { sort: { label: "pricing", p: 0.64 } },
    extract: {
      "read-fields": { urgent: "yes", invoiceNumber: "" },
      order: { orderTotal: "29", product: "Starter plan" },
    },
    tool: { "lookup-customer": { rowCount: "0" }, "find-invoice": { rowCount: "0" } },
  },
  lee: {
    id: "lee",
    from: "lee@harbor.example",
    subject: "Starter plan for 3 people",
    snippet: "Could you send me a quote for the starter plan for three of us?",
    facts: {
      sender_domain: "harbor.example",
      subject: "Starter plan for 3 people",
      has_attachment: "no",
      is_reply: "no",
    },
    classify: { sort: { label: "pricing", p: 0.91 } },
    extract: {
      "read-fields": { urgent: "no", invoiceNumber: "" },
      order: { orderTotal: "180", product: "Starter plan" },
    },
    tool: { "lookup-customer": { rowCount: "3" }, "find-invoice": { rowCount: "0" } },
  },
};

export const SAMPLES_BY_SHAPE: Record<ShapeId, SampleMessage[]> = {
  sorting: [SAMPLES.dana, SAMPLES.ops, SAMPLES.sam],
  every: [SAMPLES.ops, SAMPLES.sam, SAMPLES.dana],
  nested: [SAMPLES.dana, SAMPLES.lee, SAMPLES.sam],
  empty: [],
};
