import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ValidationError } from "../errors";
import { formValues, parseForm, parseValue } from "../forms";

function formOf(entries: [string, string | Blob][]): FormData {
  const form = new FormData();
  for (const [name, value] of entries) form.append(name, value);
  return form;
}

describe("formValues", () => {
  it("hands back each text field, and every value of a field read as a list", () => {
    const form = formOf([
      ["workflowId", "w1"],
      ["tag", "sales"],
      ["tag", "support"],
      ["handoff", "on"],
    ]);

    expect(formValues(form, ["tag", "none"])).toEqual({
      values: { workflowId: "w1", handoff: "on" },
      lists: { tag: ["sales", "support"], none: [] },
    });
  });

  it("never hands back a file", () => {
    const form = formOf([
      ["name", "sales"],
      ["upload", new Blob(["someone's mail"])],
    ]);

    expect(formValues(form)).toEqual({ values: { name: "sales" }, lists: {} });
  });
});

describe("parseForm and parseValue", () => {
  it("turn input that doesn't match the schema into ValidationError, not a ZodError", () => {
    const schema = z.object({ tagId: z.string().min(1) });

    expect(() => parseForm(schema, formOf([]))).toThrow(ValidationError);
    expect(() => parseValue(z.string().min(1), 42)).toThrow(ValidationError);
    expect(parseValue(z.string().min(1), "w1")).toBe("w1");
  });
});
