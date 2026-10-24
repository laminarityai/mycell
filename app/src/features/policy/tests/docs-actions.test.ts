// Suggesting edits to a Doc is an external send (ADR-0013, ADR-0017): a tool step makes them as
// suggestions, and the engine inserts a `suggested_edits` approval right after it when nothing on
// its own path reviews them. Requests Docs refuses in suggest mode are refused as the spec is
// saved, and so is anything that isn't an edit.
import { describe, expect, it } from "vitest";
import { findStep } from "@/features/spec/tree";
import { googleScope } from "@/lib/google";
import { appsUsed } from "../action-set";
import { actionsAllowedBy, catalog, catalogActionSet } from "../catalog";
import { SUGGEST_MODE_REFUSED } from "../docs-requests";
import { applyPolicy } from "../engine";
import { specWithSteps } from "./specs";

const suggest = (requests: unknown[]) => ({
  id: "suggest",
  type: "tool",
  action: "google-docs.suggest-edits",
  input: { documentId: "doc-1", requests },
});

const insert = { insertText: { text: "Status: on track.", endOfSegmentLocation: {} } };

describe("the Docs actions", () => {
  it("read a doc at read risk and suggest edits at external_send, waiting as suggestions", () => {
    expect(catalog["google-docs.read-document"]).toMatchObject({ app: "Docs", risk: "read" });
    expect(catalog["google-docs.suggest-edits"]).toMatchObject({
      app: "Docs",
      risk: "external_send",
      channel: "suggested_edits",
      pendingForm: expect.stringContaining("suggested edits") as string,
    });
  });

  it("need Docs: reading takes a read scope, suggesting a read-write one", () => {
    const names = (scopes: string[]) =>
      actionsAllowedBy(scopes)
        .map((action) => action.name)
        .filter((name) => name.startsWith("google-docs."));

    expect(names([googleScope("documents")])).toEqual([
      "google-docs.read-document",
      "google-docs.suggest-edits",
    ]);
    expect(names([googleScope("documents.readonly")])).toEqual(["google-docs.read-document"]);
    expect(names([googleScope("gmail.modify")])).toEqual([]);
    expect(appsUsed(["google-docs.suggest-edits"], catalogActionSet)).toEqual(["Gmail", "Docs"]);
  });
});

describe("a suggest-edits tool step", () => {
  it("gets a suggested_edits approval inserted right after it", () => {
    const result = applyPolicy(specWithSteps([suggest([insert])]), catalogActionSet);

    expect(result).toMatchObject({
      ok: true,
      maxRisk: "external_send",
      inserted: [
        { stepId: "suggest-approval", after: "suggest", action: "google-docs.suggest-edits" },
      ],
    });
    if (!result.ok) return;
    expect(findStep(result.spec, "suggest-approval")).toEqual({
      id: "suggest-approval",
      type: "approval",
      channel: "suggested_edits",
    });
  });

  it("needs nothing inserted when a suggested_edits approval follows it, but a Gmail one won't do", () => {
    const reviewed = specWithSteps([
      suggest([insert]),
      { id: "check", type: "approval", channel: "suggested_edits" },
    ]);
    const wrong = specWithSteps([
      suggest([insert]),
      { id: "check", type: "approval", channel: "gmail_drafts" },
    ]);

    expect(applyPolicy(reviewed, catalogActionSet)).toMatchObject({ ok: true, inserted: [] });
    expect(applyPolicy(wrong, catalogActionSet)).toMatchObject({
      ok: true,
      inserted: [{ stepId: "suggest-approval" }],
    });
  });

  it("can't be a draft step's output", () => {
    const spec = specWithSteps([
      {
        id: "draft",
        type: "draft",
        role: "smart",
        instructions: "Suggest a status line.",
        context: ["trigger.message"],
        output: "google-docs.suggest-edits",
      },
    ]);

    expect(applyPolicy(spec, catalogActionSet)).toMatchObject({
      ok: false,
      issues: [
        { path: ["steps", 0, "output"], message: expect.stringContaining("tool step") as string },
      ],
    });
  });

  it("refuses at save each request Docs refuses in suggest mode, naming it", () => {
    const refused = SUGGEST_MODE_REFUSED.map((kind) => ({ [kind]: {} }));
    const result = applyPolicy(specWithSteps([suggest([insert, ...refused])]), catalogActionSet);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      {
        path: ["steps", 0, "input", "requests", 1, "addDocumentTab"],
        message: expect.stringContaining("addDocumentTab") as string,
      },
    ]);
    for (const kind of SUGGEST_MODE_REFUSED) {
      const one = applyPolicy(specWithSteps([suggest([{ [kind]: {} }])]), catalogActionSet);
      expect(one, kind).toMatchObject({
        ok: false,
        issues: [{ message: expect.stringContaining(kind) as string }],
      });
    }
  });

  it("refuses a document style change to the fields Docs can't suggest, and allows the rest", () => {
    const style = (fields: string) => ({
      updateDocumentStyle: { documentStyle: { marginTop: { magnitude: 72, unit: "PT" } }, fields },
    });
    const refused = (fields: string) =>
      !applyPolicy(specWithSteps([suggest([style(fields)])]), catalogActionSet).ok;

    expect(refused("documentFormat")).toBe(true);
    expect(refused("marginTop,useEvenPageHeaderFooter")).toBe(true);
    expect(refused("useFirstPageHeaderFooter")).toBe(true);
    expect(refused("*")).toBe(true);
    expect(refused("marginTop")).toBe(false);
  });

  it("refuses requests that accept, reject or delete suggestions, or comment, and unknown ones", () => {
    for (const request of [
      { acceptSuggestion: { suggestionId: "suggest.1" } },
      { rejectSuggestion: { suggestionId: "suggest.1" } },
      { deleteSuggestion: { suggestionId: "suggest.1" } },
      { insertComment: { content: "Looks good" } },
      { insertTextt: { text: "typo" } },
      { insertText: { text: "a" }, replaceAllText: { replaceText: "b" } },
    ]) {
      const result = applyPolicy(specWithSteps([suggest([request])]), catalogActionSet);
      expect(result.ok, JSON.stringify(request)).toBe(false);
    }
  });

  it("takes text read from a step above anywhere inside a request, checked in the run", () => {
    const spec = specWithSteps([
      {
        id: "status",
        type: "extract",
        role: "fast",
        fields: { line: { type: "string", description: "This week's status, one line" } },
      },
      suggest([
        { insertText: { text: { from: "status.line" }, endOfSegmentLocation: {} } },
        {
          replaceAllText: {
            containsText: { text: "{{status}}", matchCase: true },
            replaceText: { from: "status.line" },
          },
        },
      ]),
    ]);

    expect(applyPolicy(spec, catalogActionSet)).toMatchObject({ ok: true });
  });
});
