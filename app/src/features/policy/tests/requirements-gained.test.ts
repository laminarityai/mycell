// What a new workflow version needs that the previous one didn't (M5): decided from the
// catalog's fixed risk levels, apps and scopes, never from anything a spec or model says.
import { describe, expect, it } from "vitest";
import { requirementsGained } from "../engine";

const LABEL = "google-mail.add-label";
const DRAFT = "google-mail.create-draft";
const READ_MESSAGE = "google-mail.read-message";
const READ_RANGE = "google-sheet.read-range";

describe("comparing a new version's requirements with the previous one's", () => {
  it("finds nothing gained when only a prompt or threshold changed", () => {
    const before = { maxRisk: "internal_reversible", requiredActions: [LABEL] } as const;

    expect(requirementsGained(before, before)).toBeNull();
  });

  it("finds the max risk raised when an external send is added", () => {
    expect(
      requirementsGained(
        { maxRisk: "internal_reversible", requiredActions: [LABEL] },
        { maxRisk: "external_send", requiredActions: [LABEL, DRAFT] },
      ),
    ).toEqual({ maxRiskRaised: { from: "internal_reversible", to: "external_send" } });
  });

  it("finds Sheets new when a version starts reading a spreadsheet", () => {
    expect(
      requirementsGained(
        { maxRisk: "read", requiredActions: [READ_MESSAGE] },
        { maxRisk: "read", requiredActions: [READ_MESSAGE, READ_RANGE] },
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
      ),
    ).toEqual({ newScopes: ["gmail.modify"] });
  });

  it("finds nothing gained when the new actions are allowed by what the old ones needed", () => {
    // Labelling needs gmail.modify, which reading a message's labels accepts too.
    expect(
      requirementsGained(
        { maxRisk: "internal_reversible", requiredActions: [LABEL] },
        { maxRisk: "internal_reversible", requiredActions: [LABEL, READ_MESSAGE] },
      ),
    ).toBeNull();
  });

  it("finds nothing gained when the risk goes down or an app is dropped", () => {
    expect(
      requirementsGained(
        { maxRisk: "external_send", requiredActions: [DRAFT, LABEL, READ_RANGE] },
        { maxRisk: "internal_reversible", requiredActions: [LABEL] },
      ),
    ).toBeNull();
  });
});
