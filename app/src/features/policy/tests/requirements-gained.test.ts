// What a new workflow version needs that the previous one didn't (M5): decided from the
// catalog's fixed risk levels, apps and scopes, never from anything a spec or model says.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { actionSetOf, appsUsed } from "../action-set";
import { catalogActionSet } from "../catalog";
import { requirementsGained } from "../engine";
import type { CustomAction } from "../types";

const LABEL = "google-mail.add-label";
const DRAFT = "google-mail.create-draft";
const READ_MESSAGE = "google-mail.read-message";
const READ_RANGE = "google-sheet.read-range";

describe("comparing a new version's requirements with the previous one's", () => {
  it("finds nothing gained when only a prompt or threshold changed", () => {
    const before = { maxRisk: "internal_reversible", requiredActions: [LABEL] } as const;

    expect(requirementsGained(before, before, catalogActionSet)).toBeNull();
  });

  it("finds the max risk raised when an external send is added", () => {
    expect(
      requirementsGained(
        { maxRisk: "internal_reversible", requiredActions: [LABEL] },
        { maxRisk: "external_send", requiredActions: [LABEL, DRAFT] },
        catalogActionSet,
      ),
    ).toEqual({ maxRiskRaised: { from: "internal_reversible", to: "external_send" } });
  });

  it("finds Sheets new when a version starts reading a spreadsheet", () => {
    expect(
      requirementsGained(
        { maxRisk: "read", requiredActions: [READ_MESSAGE] },
        { maxRisk: "read", requiredActions: [READ_MESSAGE, READ_RANGE] },
        catalogActionSet,
      ),
    ).toEqual({ newApps: ["Sheets"], newScopes: ["drive.readonly"] });
  });

  it("finds a scope new when an action needs one the previous actions didn't", () => {
    // Drafting is allowed by gmail.modify or gmail.compose, so a connection that ran the
    // drafts may lack gmail.modify, which labelling needs.
    expect(
      requirementsGained(
        { maxRisk: "external_send", requiredActions: [DRAFT] },
        { maxRisk: "external_send", requiredActions: [DRAFT, LABEL] },
        catalogActionSet,
      ),
    ).toEqual({ newScopes: ["gmail.modify"] });
  });

  it("finds nothing gained when the new actions are allowed by what the old ones needed", () => {
    // Labelling needs gmail.modify, which reading a message's labels accepts too.
    expect(
      requirementsGained(
        { maxRisk: "internal_reversible", requiredActions: [LABEL] },
        { maxRisk: "internal_reversible", requiredActions: [LABEL, READ_MESSAGE] },
        catalogActionSet,
      ),
    ).toBeNull();
  });

  it("finds Calendar new when a version starts on new invites instead of new mail", () => {
    expect(
      requirementsGained(
        { maxRisk: "internal_reversible", requiredActions: [LABEL] },
        {
          maxRisk: "internal_reversible",
          requiredActions: [LABEL],
          trigger: "calendar.invite_received",
        },
        catalogActionSet,
      ),
    ).toEqual({ newApps: ["Calendar"] });
  });

  it("finds nothing gained when the risk goes down or an app is dropped", () => {
    expect(
      requirementsGained(
        { maxRisk: "external_send", requiredActions: [DRAFT, LABEL, READ_RANGE] },
        { maxRisk: "internal_reversible", requiredActions: [LABEL] },
        catalogActionSet,
      ),
    ).toBeNull();
  });
});

describe("the apps a workflow uses", () => {
  // Custom reads on Google, one in Gmail and one in Calendar, and one in Microsoft 365.
  const customRead = (name: string, registeredApp: string, app: string, path: string) =>
    ({
      kind: "custom",
      name,
      app,
      description: "Read one thing.",
      risk: "read",
      registeredApp,
      scopes: [],
      input: z.object({}),
      output: z.object({}),
      request: { method: "GET", path, query: {}, body: {}, outputs: {} },
    }) satisfies CustomAction;
  const actions = actionSetOf([
    ...catalogActionSet.actions,
    customRead("google.read-label", "google", "Google", "/gmail/v1/users/me/labels/{id}"),
    customRead(
      "google.read-event",
      "google",
      "Google",
      "/calendar/v3/calendars/primary/events/{id}",
    ),
    customRead("google.read-other", "google", "Google", "/youtube/v3/videos"),
    customRead("microsoft.read-message", "microsoft", "Microsoft 365", "/v1.0/me/messages/{id}"),
  ]);

  it("are Gmail, then each catalog action's app, each once", () => {
    expect(appsUsed([LABEL, READ_RANGE, DRAFT], actions)).toEqual(["Gmail", "Sheets"]);
  });

  it("name a custom Google action's own Google app, from its path", () => {
    expect(appsUsed(["google.read-event", "google.read-label"], actions)).toEqual([
      "Gmail",
      "Calendar",
    ]);
  });

  it("name Google for a custom Google action no Google app serves, and another app by its name", () => {
    expect(appsUsed(["google.read-other", "microsoft.read-message"], actions)).toEqual([
      "Gmail",
      "Google",
      "Microsoft 365",
    ]);
  });

  it("make a version that starts calling a new Google app gain it", () => {
    expect(
      requirementsGained(
        { maxRisk: "read", requiredActions: ["google.read-label"] },
        { maxRisk: "read", requiredActions: ["google.read-label", "google.read-event"] },
        actions,
      ),
    ).toEqual({ newApps: ["Calendar"] });
  });
});
