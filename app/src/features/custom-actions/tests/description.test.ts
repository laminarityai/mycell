// Checking a custom action's description (ADR-0018): the call stays on its registered app, names
// only its own inputs, and gets its level from the fixed rule, never from the description.
import { describe, expect, it } from "vitest";
import { checkCustomAction } from "../description";
import { readOutlookMessage } from "@/db/testing/custom-actions";

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
    const lowered = checkCustomAction(
      readOutlookMessage({ call: { method: "POST", path: "/v1.0/me/sendMail" }, risk: "read" }),
    );
    expect(lowered.ok).toBe(false);
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

  it("refuses writes until held sends exist, and deletes outright", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(checkCustomAction(withCall({ method })), method).toMatchObject({ ok: false });
    }
    expect(checkCustomAction(withCall({ method: "DELETE" }))).toEqual({
      ok: false,
      issues: ["A custom action can't delete."],
    });
  });

  it("refuses a catalog action's name", () => {
    expect(checkCustomAction(readOutlookMessage({ name: "google-mail.read-message" }))).toEqual({
      ok: false,
      issues: ['"google-mail.read-message" is a catalog action\'s name. Choose another.'],
    });
  });
});
