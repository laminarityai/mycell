// Checking a custom action's description (ADR-0018): the call stays on its registered app, names
// only its own inputs, and gets its level from the fixed rule, never from the description.
import { describe, expect, it } from "vitest";
import { checkCustomAction } from "../description";
import { readOutlookMessage, REPLY_PATH, replyToOutlookMessage } from "@/db/testing/custom-actions";

const withCall = (call: Record<string, unknown>) =>
  readOutlookMessage({ call: { method: "GET", path: "/v1.0/me/messages/{messageId}", ...call } });

describe("checking a custom action's description", () => {
  it("takes a read, at the level the rule sets, dropping a level the builder proposes", () => {
    const check = checkCustomAction(readOutlookMessage({ risk: "read" }));

    expect(check).toMatchObject({
      ok: true,
      action: { name: "microsoft.read-message", app: "microsoft", risk: "read" },
    });
    // A write that proposes `read` is still a write.
    const lowered = checkCustomAction(replyToOutlookMessage({ risk: "read" }));
    expect(lowered).toMatchObject({ ok: true, action: { risk: "external_send" } });
  });

  it("refuses a path that names an input it hasn't got", () => {
    expect(checkCustomAction(withCall({ path: "/v1.0/me/messages/{id}" }))).toEqual({
      ok: false,
      issues: ['The path names "id", which isn\'t an input.'],
    });
  });

  it("refuses a path that would leave the app's hosts", () => {
    for (const path of [
      "https://evil.example/v1.0/me",
      "//evil.example/v1.0/me",
      "/v1.0/me/../../evil",
      "/v1.0/me/%2e%2e/evil",
      "v1.0/me",
      "/v1.0/me\\evil",
    ]) {
      const check = checkCustomAction(withCall({ path }));
      expect(check, path).toMatchObject({ ok: false });
      expect(!check.ok && check.issues.some((issue) => issue.includes("isn't a path on"))).toBe(
        true,
      );
    }
  });

  it("refuses a Google path no Google API serves", () => {
    const check = checkCustomAction(
      readOutlookMessage({ app: "google", call: { method: "GET", path: "/unknown/v1/things" } }),
    );

    expect(check).toMatchObject({ ok: false });
  });

  it("refuses an app that isn't registered", () => {
    expect(checkCustomAction(readOutlookMessage({ app: "pipedrive" }))).toMatchObject({
      ok: false,
    });
  });

  it("takes a write at external_send, and refuses deletes outright", () => {
    for (const method of ["POST", "PUT", "PATCH"]) {
      expect(
        checkCustomAction(
          replyToOutlookMessage({
            call: { method, path: REPLY_PATH, body: { comment: "comment" } },
          }),
        ),
        method,
      ).toMatchObject({
        ok: true,
        action: { risk: "external_send" },
      });
    }
    expect(checkCustomAction(withCall({ method: "DELETE" }))).toEqual({
      ok: false,
      issues: ["A custom action can't delete."],
    });
  });

  it("lets a reviewer edit only a write's text inputs", () => {
    expect(checkCustomAction(replyToOutlookMessage({ editable: ["messageId"] }))).toMatchObject({
      ok: true,
    });
    expect(
      checkCustomAction(
        replyToOutlookMessage({
          inputs: {
            messageId: { type: "text", description: "The message's ID." },
            comment: { type: "number", description: "Not text." },
          },
          editable: ["comment"],
        }),
      ),
    ).toEqual({ ok: false, issues: ['editable names "comment", which isn\'t a text input.'] });
    expect(checkCustomAction(readOutlookMessage({ editable: ["messageId"] }))).toEqual({
      ok: false,
      issues: ["Only a write has text a reviewer edits: a read sends nothing to review."],
    });
  });

  it("needs a read to name a result field, and a write may name none", () => {
    expect(checkCustomAction(readOutlookMessage({ outputs: {} }))).toEqual({
      ok: false,
      issues: ["outputs: Name at least one result field."],
    });
    expect(checkCustomAction(replyToOutlookMessage({ outputs: {} }))).toMatchObject({ ok: true });
  });

  it("refuses a catalog action's name", () => {
    expect(checkCustomAction(readOutlookMessage({ name: "google-mail.read-message" }))).toEqual({
      ok: false,
      issues: ['"google-mail.read-message" is a catalog action\'s name. Choose another.'],
    });
  });
});
