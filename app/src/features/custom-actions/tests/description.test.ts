// Checking a custom action's description (ADR-0018): the call stays on its registered app, names
// only its own inputs, and gets its level from the fixed rule, never from the description.
import { describe, expect, it } from "vitest";
import { actionSetWith, checkCustomAction, customActionWords } from "../description";
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

  it("takes a nested body by dotted paths, and refuses paths that don't make one body", () => {
    const withBody = (body: Record<string, string>) =>
      replyToOutlookMessage({
        call: { method: "POST", path: REPLY_PATH, body },
        inputs: {
          messageId: { type: "text", description: "The Outlook message's ID." },
          comment: { type: "text", description: "The reply's text." },
          to: { type: "text", description: "Who it goes to." },
        },
      });

    expect(
      checkCustomAction(
        withBody({ "message.body.content": "comment", "message.toRecipients.0.address": "to" }),
      ),
    ).toMatchObject({ ok: true });
    expect(checkCustomAction(withBody({ "message body": "comment" }))).toEqual({
      ok: false,
      issues: [
        "body.message body: write a body field like message.body.content, property names and list indexes joined by dots.",
      ],
    });
    expect(checkCustomAction(withBody({ message: "comment", "message.subject": "to" }))).toEqual({
      ok: false,
      issues: ["body.message holds one input, so body.message.subject can't be inside it."],
    });
    expect(checkCustomAction(withBody({ "0.text": "comment" }))).toEqual({
      ok: false,
      issues: ["body.0.text: the body is an object, so it can't start with a list index."],
    });
    expect(checkCustomAction(withBody({ "to.0": "comment", "to.name": "to" }))).toEqual({
      ok: false,
      issues: ["body.to holds either properties or list items, not both."],
    });
    expect(checkCustomAction(withBody({ "to.0": "comment", "to.2": "to" }))).toEqual({
      ok: false,
      issues: ["body.to is a list: number its items from 0, with none missing."],
    });
    expect(checkCustomAction(withBody({ "a.__proto__.b": "comment" }))).toEqual({
      ok: false,
      issues: ['body.a.__proto__.b: "__proto__" can\'t be a field name.'],
    });
  });

  it("refuses a GraphQL call in an app with no GraphQL API, which is every registered app yet", () => {
    for (const app of ["google", "microsoft"]) {
      const check = checkCustomAction(
        readOutlookMessage({
          app,
          call: { graphql: "query { viewer { name } }", path: "/gmail/v1/graphql" },
          inputs: {},
          outputs: { name: { type: "text", label: "Your name", path: "data.viewer.name" } },
        }),
      );
      expect(!check.ok && check.issues.some((issue) => issue.includes("has no GraphQL API"))).toBe(
        true,
      );
    }
  });

  it("refuses a catalog action's name", () => {
    expect(checkCustomAction(readOutlookMessage({ name: "google-mail.read-message" }))).toEqual({
      ok: false,
      issues: ['"google-mail.read-message" is a catalog action\'s name. Choose another.'],
    });
  });

  it("refuses a name in the catalog's own words, which it keeps for actions it adds later", () => {
    for (const [name, word] of [
      ["google-mail.read-labels", "google-mail"],
      ["google-calendar.list-calendars", "google-calendar"],
    ]) {
      expect(checkCustomAction(readOutlookMessage({ name })), name).toEqual({
        ok: false,
        issues: [
          `Names starting "${word}." are kept for catalog actions: name a custom action after its app's word, such as "microsoft.read-message".`,
        ],
      });
    }
    expect(checkCustomAction(readOutlookMessage({ name: "google.read-event" }))).toMatchObject({
      ok: true,
    });
  });
});

describe("an org's action set", () => {
  it("keeps the catalog's action when a stored custom action has its name", () => {
    const check = checkCustomAction(readOutlookMessage());
    if (!check.ok) throw new Error(check.issues.join(" "));
    // Stored before the catalog gained an action of the same name.
    const clash = { ...check.action, name: "google-mail.read-message" };

    const actions = actionSetWith([clash]);

    expect(actions.find("google-mail.read-message")).toMatchObject({ kind: "catalog" });
    expect(actions.actions.filter((action) => action.name === clash.name)).toHaveLength(1);
  });
});

describe("a custom action in plain words", () => {
  it("names its app as admins do, its sentence, its method and path, and its level", () => {
    const check = checkCustomAction(readOutlookMessage());
    if (!check.ok) throw new Error(check.issues.join(" "));

    expect(customActionWords(check.action)).toEqual({
      name: "microsoft.read-message",
      app: "Microsoft 365",
      description: "Read one Outlook message: its subject, sender and whether it was read.",
      call: "GET /v1.0/me/messages/{messageId}",
      risk: "read",
    });
  });
});
