import { describe, expect, it } from "vitest";
import { checkOn, withOperator } from "../conditions";

describe("checkOn", () => {
  it("starts a check on a field with its type's first operator and a blank of its type", () => {
    expect(checkOn({ from: "trigger.subject", type: "text" })).toEqual({
      subject: { from: "trigger.subject" },
      op: "is",
      value: "",
    });
    expect(checkOn({ from: "details.total", type: "number" })).toEqual({
      subject: { from: "details.total" },
      op: "equals",
      value: 0,
    });
    expect(checkOn({ from: "trigger.isReply", type: "yesNo" })).toEqual({
      subject: { from: "trigger.isReply" },
      op: "is_yes",
    });
  });
});

describe("withOperator", () => {
  const subject = { from: "details.product" };

  it("keeps a value that fits the new operator, and drops one an operator doesn't take", () => {
    expect(withOperator({ subject, op: "is", value: "Chair" }, "contains")).toEqual({
      subject,
      op: "contains",
      value: "Chair",
    });
    expect(withOperator({ subject, op: "is", value: "Chair" }, "is_empty")).toEqual({
      subject,
      op: "is_empty",
    });
  });

  it("gives an operator that takes a value a blank of its type", () => {
    expect(withOperator({ subject, op: "is_empty" }, "starts_with")).toEqual({
      subject,
      op: "starts_with",
      value: "",
    });
    expect(withOperator({ subject, op: "is_empty" }, "more_than")).toEqual({
      subject,
      op: "more_than",
      value: 0,
    });
  });
});
