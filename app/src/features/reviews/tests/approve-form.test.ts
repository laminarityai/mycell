// The approve form as its Server Action reads it: the review, and the person's edits, if any.
import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { parseForm } from "@/lib/forms";
import { approveFormSchema } from "../types";

const parseApproveForm = (data: FormData) => parseForm(approveFormSchema, data);

function form(entries: [string, string | Blob][]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe("the approve form", () => {
  it("approves as it is when nothing was edited", () => {
    expect(parseApproveForm(form([["reviewId", "r1"]]))).toEqual({ reviewId: "r1" });
  });

  it("carries a draft's edited text", () => {
    const parsed = parseApproveForm(
      form([
        ["reviewId", "r1"],
        ["text", "Thanks!"],
      ]),
    );

    expect(parsed).toEqual({ reviewId: "r1", edits: { text: "Thanks!" } });
  });

  it("carries a held send's edited fields by input name", () => {
    const parsed = parseApproveForm(
      form([
        ["reviewId", "r1"],
        ["field:comment", "Thanks Ada"],
        ["$ACTION_ID_abc", ""],
      ]),
    );

    expect(parsed).toEqual({ reviewId: "r1", edits: { fields: { comment: "Thanks Ada" } } });
  });

  it("refuses a field that isn't text, or one with no name", () => {
    const file = new Blob(["x"]);
    for (const entries of [[["field:comment", file]], [["field:", "Thanks"]]] as [
      string,
      string | Blob,
    ][][]) {
      expect(() => parseApproveForm(form([["reviewId", "r1"], ...entries]))).toThrow(
        ValidationError,
      );
    }
  });
});
