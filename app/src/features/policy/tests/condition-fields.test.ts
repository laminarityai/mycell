import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ValueType } from "@/features/spec/types";
import { catalog, catalogActionSet } from "../catalog";
import { checkChoices, testableFields } from "../condition-fields";
import { applyPolicy } from "../engine";
import { parsedSpec } from "./specs";

const value = (from: string, op: string, compared?: string | number) => ({
  subject: { from },
  op,
  ...(compared === undefined ? {} : { value: compared }),
});
const escalate = (id: string) => ({ id, type: "escalate", reason: "A person looks." });

/**
 * Extract the order, look the customer up in a sheet, read the thread, then a branch with one
 * path whose checks are `checks`, holding `inner` (more steps and branches).
 */
function lookupSpec(checks: unknown[], inner: unknown[] = []) {
  return parsedSpec({
    specVersion: 2,
    id: "lookup",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    autonomy: { rung: 3 },
    steps: [
      {
        id: "order",
        type: "extract",
        role: "fast",
        fields: {
          customer: { type: "string", description: "The customer's name" },
          rush: { type: "boolean", description: "Whether they need it fast" },
        },
      },
      {
        id: "lookup",
        type: "tool",
        action: "google-sheet.read-range",
        input: { spreadsheetId: "sheet-1", range: "Customers!A:C" },
      },
      {
        id: "thread",
        type: "tool",
        action: "google-mail.read-thread",
        input: { threadId: { from: "trigger.threadId" } },
      },
      {
        id: "route",
        type: "branch",
        paths: [
          { id: "known", name: "Known", condition: { combine: "all", checks }, steps: inner },
        ],
        otherwise: { id: "rest", steps: [] },
      },
    ],
  });
}
const checkAt = (c: number, ...field: string[]) => [
  "steps",
  3,
  "paths",
  0,
  "condition",
  "checks",
  c,
  ...field,
];

/** The JSON Schema types a field of each condition type may have in an action's output. */
const JSON_TYPES: Record<ValueType, string[]> = {
  text: ["string"],
  number: ["number", "integer"],
  yesNo: ["boolean"],
};

describe("the catalog's condition fields", () => {
  it("each exist in their action's output schema, with the type they declare", () => {
    for (const action of Object.values(catalog)) {
      const output = z.toJSONSchema(action.output) as {
        properties?: Record<string, { type?: string }>;
      };
      for (const field of action.conditionFields ?? []) {
        const declared = output.properties?.[field.name];
        expect(declared, `${action.name} gives no ${field.name}`).toBeDefined();
        expect(JSON_TYPES[field.type], `${action.name}.${field.name}`).toContain(declared?.type);
      }
    }
  });

  it("let a condition test a thread's message count, a sheet's row count, an event's guest count and memory's fact count", () => {
    const declared = Object.values(catalog).flatMap((action) =>
      (action.conditionFields ?? []).map((field) => [action.name, field.name, field.type]),
    );

    expect(declared).toEqual([
      ["google-mail.read-thread", "messageCount", "number"],
      ["google-sheet.read-range", "rowCount", "number"],
      ["google-calendar.read-event", "guestCount", "number"],
      ["memory.lookup", "factCount", "number"],
    ]);
  });
});

describe("applyPolicy on checks of a tool step's result", () => {
  it("lets a condition test a sheet lookup's row count and a thread's message count", () => {
    const spec = lookupSpec([
      value("lookup.rowCount", "more_than", 0),
      value("thread.messageCount", "at_least", 2),
    ]);

    expect(applyPolicy(spec, catalogActionSet)).toMatchObject({ ok: true });
  });

  it("refuses a field the action doesn't declare, and an operator its type doesn't allow", () => {
    const spec = lookupSpec([
      value("lookup.range", "is", "Customers!A:C"),
      value("lookup.rowCount", "contains", "1"),
    ]);

    expect(applyPolicy(spec, catalogActionSet)).toEqual({
      ok: false,
      issues: [
        {
          path: checkAt(0, "subject", "from"),
          message:
            '"lookup" (google-sheet.read-range) gives no field "range" to test; it may test rowCount.',
        },
        {
          path: checkAt(1, "op"),
          message: 'lookup.rowCount is a number, so "contains" can\'t check it.',
        },
      ],
    });
  });
});

describe("testableFields", () => {
  it("lists the trigger's facts, then each field above the branch on its path, with its type", () => {
    const many = {
      id: "many",
      name: "Many",
      condition: { combine: "all", checks: [value("count.chairs", "more_than", 10)] },
      steps: [escalate("big")],
    };
    const inner = [
      {
        id: "count",
        type: "extract",
        role: "fast",
        fields: { chairs: { type: "number", description: "How many chairs" } },
      },
      { id: "size", type: "branch", paths: [many], otherwise: { id: "few", steps: [] } },
    ];
    const spec = lookupSpec([value("lookup.rowCount", "more_than", 0)], inner);

    expect(testableFields(spec, "size", catalogActionSet)).toEqual([
      { from: "trigger.sender", type: "text", label: "The sender's address" },
      { from: "trigger.senderDomain", type: "text", label: "The sender's domain" },
      { from: "trigger.subject", type: "text", label: "The subject" },
      { from: "trigger.hasAttachment", type: "yesNo", label: "Has an attachment" },
      { from: "trigger.isReply", type: "yesNo", label: "Is a reply" },
      { from: "order.customer", type: "text", label: "The customer's name" },
      { from: "order.rush", type: "yesNo", label: "Whether they need it fast" },
      { from: "lookup.rowCount", type: "number", label: "The number of rows read" },
      {
        from: "thread.messageCount",
        type: "number",
        label: "The number of messages in the thread",
      },
      { from: "count.chairs", type: "number", label: "How many chairs" },
    ]);
    expect(
      testableFields(spec, "route", catalogActionSet).map((field) => field.from),
    ).not.toContain("count.chairs");
    expect(testableFields(spec, "lookup", catalogActionSet)).toEqual([]);
  });
});

describe("checkChoices", () => {
  /** Classify the message, then a branch with a sorting path and a sizing path, each with its own steps. */
  function sortingSpec() {
    const sizing = {
      id: "big",
      name: "Big",
      condition: { combine: "all", checks: [value("order.rush", "is_yes")] },
      steps: [
        {
          id: "count",
          type: "extract",
          role: "fast",
          fields: { chairs: { type: "number", description: "How many chairs" } },
        },
        {
          id: "size",
          type: "branch",
          paths: [
            {
              id: "many",
              name: "Many",
              condition: { combine: "all", checks: [value("count.chairs", "more_than", 10)] },
              steps: [escalate("big-one")],
            },
          ],
          otherwise: { id: "few", steps: [] },
        },
      ],
    };
    const sorting = {
      id: "sorted",
      name: "Sorted",
      condition: { combine: "all", checks: [{ classify: "kind", is: "sales", minP: 0.8 }] },
      steps: [
        { id: "mood", type: "classify", role: "classify", question: "Happy?", labels: ["y", "n"] },
        {
          id: "notes",
          type: "extract",
          role: "fast",
          fields: { tone: { type: "string", description: "Their tone" } },
        },
        {
          id: "inner",
          type: "branch",
          paths: [
            {
              id: "happy",
              name: "Happy",
              condition: { combine: "all", checks: [{ classify: "mood", is: "y", minP: 0.8 }] },
              steps: [],
            },
          ],
          otherwise: { id: "unhappy", steps: [] },
        },
      ],
    };
    return parsedSpec({
      specVersion: 2,
      id: "sorting",
      credentials: "member",
      trigger: { type: "gmail.message_received" },
      autonomy: { rung: 3 },
      steps: [
        {
          id: "kind",
          type: "classify",
          role: "classify",
          question: "What is it?",
          labels: ["sales", "support"],
        },
        {
          id: "order",
          type: "extract",
          role: "fast",
          fields: { rush: { type: "boolean", description: "Whether they need it fast" } },
        },
        {
          id: "route",
          type: "branch",
          paths: [sorting, sizing],
          otherwise: { id: "rest", steps: [] },
        },
      ],
    });
  }

  it("offers a branch's classify answers and fields from above it on its own path only", () => {
    const spec = sortingSpec();

    const choices = checkChoices(spec, "size", catalogActionSet);

    expect(choices.answers).toEqual([
      { classify: "kind", is: "sales", label: '"kind" says "sales"' },
      { classify: "kind", is: "support", label: '"kind" says "support"' },
    ]);
    expect(choices.fields.map((field) => field.from)).toEqual([
      "trigger.sender",
      "trigger.senderDomain",
      "trigger.subject",
      "trigger.hasAttachment",
      "trigger.isReply",
      "order.rush",
      "count.chairs",
    ]);
    const inner = checkChoices(spec, "inner", catalogActionSet);
    expect(inner.answers.map((answer) => answer.classify)).toEqual([
      "kind",
      "kind",
      "mood",
      "mood",
    ]);
    expect(inner.fields.map((field) => field.from)).toContain("notes.tone");
    expect(inner.fields.map((field) => field.from)).not.toContain("count.chairs");
  });

  it("gives each field the operators its type allows", () => {
    const fields = checkChoices(sortingSpec(), "size", catalogActionSet).fields;
    const operators = (from: string) => fields.find((field) => field.from === from)?.operators;

    expect(operators("count.chairs")).toEqual([
      "equals",
      "does_not_equal",
      "more_than",
      "less_than",
      "at_least",
      "at_most",
      "is_empty",
      "is_not_empty",
    ]);
    expect(operators("order.rush")).toEqual(["is_yes", "is_no", "is_empty", "is_not_empty"]);
    expect(operators("trigger.subject")).toEqual([
      "is",
      "is_not",
      "contains",
      "does_not_contain",
      "starts_with",
      "ends_with",
      "is_empty",
      "is_not_empty",
    ]);
  });
});
