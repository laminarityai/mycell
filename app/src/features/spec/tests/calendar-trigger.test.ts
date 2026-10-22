// The Calendar trigger in a spec (M11): a new invite starts the run, so the steps read the
// invite, never a Gmail message.
import { describe, expect, it } from "vitest";
import { graphView } from "../graph";
import { layoutTree } from "../layout";
import { newPath, newStep } from "../new-step";
import type { Spec } from "../types";
import { validateSpec } from "../validate";

function inviteSpec(steps: unknown[]) {
  return {
    specVersion: 2,
    id: "invite-triage",
    credentials: "member",
    trigger: { type: "calendar.invite_received" },
    steps,
    autonomy: { rung: 3 },
  };
}

const classify = {
  id: "kind",
  type: "classify",
  role: "classify",
  question: "Is this a sales call?",
  labels: ["yes", "no"],
};

function issues(input: unknown) {
  const result = validateSpec(input);
  return result.ok ? [] : result.issues;
}

describe("a spec with the Calendar trigger", () => {
  it("accepts steps that read the invite: classify, a tool given its ID, a branch on its facts", () => {
    const result = validateSpec(
      inviteSpec([
        classify,
        {
          id: "route",
          type: "branch",
          mode: "first",
          paths: [
            {
              id: "customers",
              name: "Customers",
              condition: {
                combine: "all",
                checks: [
                  { subject: { from: "trigger.organizerDomain" }, op: "is", value: "acme.com" },
                  { classify: "kind", is: "yes", minP: 0.8 },
                ],
              },
              steps: [
                {
                  id: "label",
                  type: "tool",
                  action: "google-mail.add-label",
                  input: { messageId: { from: "trigger.eventId" }, label: "x" },
                },
              ],
            },
          ],
          otherwise: { id: "rest", steps: [] },
        },
      ]),
    );

    expect(result).toMatchObject({
      ok: true,
      spec: { trigger: { type: "calendar.invite_received" } },
    });
  });

  it("refuses a draft and an escalate, which act on a Gmail message an invite doesn't have", () => {
    const found = issues(
      inviteSpec([
        classify,
        {
          id: "reply",
          type: "draft",
          role: "smart",
          instructions: "Reply.",
          context: [],
          output: "google-mail.create-draft",
        },
        { id: "hand-over", type: "escalate", reason: "Look." },
      ]),
    );

    expect(found.map((issue) => issue.path)).toEqual([
      ["steps", 1],
      ["steps", 2],
    ]);
    expect(found[0]?.message).toMatch(/invite/);
  });

  it("refuses the message's fields and facts, naming what the invite has", () => {
    const found = issues(
      inviteSpec([
        {
          id: "label",
          type: "tool",
          action: "google-mail.add-label",
          input: { messageId: { from: "trigger.messageId" }, label: "x" },
        },
        {
          id: "route",
          type: "branch",
          mode: "first",
          paths: [
            {
              id: "a",
              name: "A",
              condition: {
                combine: "all",
                checks: [{ subject: { from: "trigger.subject" }, op: "is", value: "x" }],
              },
              steps: [],
            },
          ],
          otherwise: { id: "rest", steps: [] },
        },
      ]),
    );

    expect(found.map((issue) => issue.path)).toEqual([
      ["steps", 0, "input", "messageId", "from"],
      ["steps", 1, "paths", 0, "condition", "checks", 0, "subject", "from"],
    ]);
    expect(found[0]?.message).toMatch(/trigger\.eventId/);
  });

  it("refuses an invite's field under the Gmail trigger", () => {
    const found = issues({
      ...inviteSpec([
        {
          id: "label",
          type: "tool",
          action: "google-mail.add-label",
          input: { messageId: { from: "trigger.eventId" }, label: "x" },
        },
      ]),
      trigger: { type: "gmail.message_received" },
    });

    expect(found.map((issue) => issue.path)).toEqual([["steps", 0, "input", "messageId", "from"]]);
  });

  it("refuses Gmail labels on the Calendar trigger", () => {
    const found = issues({
      ...inviteSpec([classify]),
      trigger: { type: "calendar.invite_received", labelIds: ["INBOX"] },
    });

    expect(found.map((issue) => issue.path)).toEqual([["trigger"]]);
  });

  it("starts a new path on the invite's facts, and a new tool on the invite's ID", () => {
    const parsed = validateSpec(
      inviteSpec([
        {
          id: "route",
          type: "branch",
          mode: "first",
          paths: [
            {
              id: "a",
              name: "A",
              condition: {
                combine: "all",
                checks: [{ subject: { from: "trigger.title" }, op: "contains", value: "x" }],
              },
              steps: [],
            },
          ],
          otherwise: { id: "rest", steps: [] },
        },
      ]),
    );
    if (!parsed.ok) throw new Error("the spec should validate");
    const spec: Spec = parsed.spec;

    expect(newPath(spec, "route").condition.checks).toEqual([
      { subject: { from: "trigger.organizer" }, op: "contains", value: "" },
    ]);
    expect(
      newStep(
        spec,
        { list: "a", after: null },
        { type: "tool", action: "x.y", inputs: ["eventId"] },
      ),
    ).toMatchObject({ input: { eventId: { from: "trigger.eventId" } } });
  });

  it("is drawn on the graph as what starts the run", () => {
    const parsed = validateSpec(inviteSpec([classify]));
    if (!parsed.ok) throw new Error("the spec should validate");

    const layout = layoutTree(graphView(parsed.spec));

    expect(layout.nodes.find((node) => node.kind === "trigger")).toMatchObject({
      label: "When a new invite lands on the calendar",
    });
    expect(graphView(null).trigger).toBe("When a message arrives in Gmail");
  });
});
