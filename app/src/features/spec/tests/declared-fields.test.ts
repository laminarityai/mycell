import { describe, expect, it } from "vitest";
import { validateSpec } from "../validate";
import { pathOf, triageWithPaths } from "./triage-spec";

const value = (from: string, op: string, compared?: string | number) => ({
  subject: { from },
  op,
  ...(compared === undefined ? {} : { value: compared }),
});
const at = (c: number, ...field: string[]) => [
  "steps",
  2,
  "paths",
  0,
  "condition",
  "checks",
  c,
  ...field,
];

describe("validateSpec on checks of the trigger's facts", () => {
  it("checks the message's sender, domain, subject, attachment and reply, by their types", () => {
    const fits = [
      value("trigger.sender", "is", "ada@customer.test"),
      value("trigger.senderDomain", "ends_with", "customer.test"),
      value("trigger.subject", "contains", "quote"),
      value("trigger.hasAttachment", "is_yes"),
      value("trigger.isReply", "is_no"),
    ];

    expect(validateSpec(triageWithPaths([pathOf("fits", fits)]))).toMatchObject({ ok: true });
  });

  it("refuses an operator that doesn't fit a fact's type, naming the type", () => {
    const misfits = [
      value("trigger.subject", "more_than", 3),
      value("trigger.hasAttachment", "is", "yes"),
    ];

    const result = validateSpec(triageWithPaths([pathOf("misfits", misfits)]));

    expect(result).toMatchObject({
      ok: false,
      issues: [
        { path: at(0, "op"), message: 'trigger.subject is text, so "more_than" can\'t check it.' },
        { path: at(1, "op") },
      ],
    });
  });

  it("refuses a fact the trigger doesn't declare, listing those it does", () => {
    const result = validateSpec(
      triageWithPaths([pathOf("body", [value("trigger.body", "is_empty")])]),
    );

    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          path: at(0, "subject", "from"),
          message: expect.stringContaining("senderDomain") as string,
        },
      ],
    });
  });
});
