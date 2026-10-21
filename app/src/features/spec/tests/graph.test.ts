import { describe, expect, it } from "vitest";
import { graphView, type GraphPath, type GraphStep, type GraphTrace } from "../graph";
import type { Spec } from "../types";
import { validateSpec } from "../validate";
import { triageSpec } from "./triage-spec";

function parsed(input: unknown): Spec {
  const result = validateSpec(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.spec;
}

const ACTIONS: Record<string, { risk: string; description: string; app: string }> = {
  "google-mail.create-draft": {
    risk: "external_send",
    description: "Write a reply to the triggering message as a draft in its thread.",
    app: "Gmail",
  },
  "google-mail.add-label": {
    risk: "internal_reversible",
    description: "Add a label to the triggering message.",
    app: "Gmail",
  },
};
const action = (name: string) => ACTIONS[name];

/** The triage spec as the policy engine leaves it: an approval after the pricing draft. */
function triageWithApproval(): Spec {
  const spec = parsed(triageSpec());
  const branch = spec.steps[2];
  if (branch.type !== "branch") throw new Error("the triage spec has a branch");
  branch.paths[1].steps.push({ id: "reply-approval", type: "approval", channel: "gmail_drafts" });
  return spec;
}

function branchOf(step: GraphStep | undefined): GraphPath[] {
  if (step?.branch == null) throw new Error("expected a branch");
  return step.branch.paths;
}

/** Each step's ID and what the test is about, at every depth, in reading order. */
function flat<T>(steps: GraphStep[], pick: (step: GraphStep) => T): [string, T][] {
  return steps.flatMap((step) => [
    [step.id, pick(step)] as [string, T],
    ...(step.branch?.paths ?? []).flatMap((path) => flat(path.steps, pick)),
  ]);
}

describe("graphView", () => {
  it("draws each step's type, one plain line and its risk, with paths in the order they're checked", () => {
    const view = graphView(triageWithApproval(), {
      action,
      insertedApprovals: ["reply-approval"],
    });

    expect(view.steps.map((step) => [step.id, step.title, step.risk])).toEqual([
      ["kind", "Classify", null],
      ["details", "Extract", null],
      ["route", "Branch · first match", null],
    ]);
    expect(view.steps[0]?.text).toBe(
      'Asks "What kind of message is this?" and picks one of: complaint, pricing, other.',
    );
    expect(view.steps[2]?.text).toBe("Runs the first path that applies, checked left to right.");
    const paths = branchOf(view.steps[2]);
    expect(paths.map((path) => [path.id, path.name, path.condition])).toEqual([
      ["complaint", "Complaint", '"kind" says "complaint" with at least 80% confidence'],
      [
        "pricing",
        "Pricing",
        '"kind" says "pricing" with at least 85% confidence or what they ask about contains "Chair"',
      ],
      ["rest", null, null],
    ]);
    expect(paths[1]?.steps.map((step) => [step.id, step.title, step.risk])).toEqual([
      ["reply", "Draft a reply", "external_send"],
      ["reply-approval", "Waits for review", null],
    ]);
  });

  it("marks the reviews the spec names and those the policy engine inserted", () => {
    const spec = triageWithApproval();
    const branch = spec.steps[2];
    if (branch.type !== "branch") throw new Error("the triage spec has a branch");
    branch.otherwise.steps.push({ id: "check", type: "approval", channel: "gmail_drafts" });

    const view = graphView(spec, { action, insertedApprovals: ["reply-approval"] });

    expect(flat(view.steps, (step) => step.review)).toEqual([
      ["kind", null],
      ["details", null],
      ["route", null],
      ["to-person", null],
      ["reply", null],
      ["reply-approval", "policy"],
      ["check", "spec"],
    ]);
  });

  it("lights up a Try it's route: the steps it ran, and why each path did or didn't run", () => {
    const complaint = { check: "complaint check", passed: false, reason: 'said "pricing"' };
    const pricing = { check: "pricing check", passed: true, reason: 'said "pricing", 93% sure' };
    const trace: GraphTrace = {
      steps: [
        { stepId: "kind", status: "succeeded" },
        { stepId: "details", status: "succeeded" },
        {
          stepId: "route",
          status: "succeeded",
          paths: [
            { id: "complaint", status: "not_taken", checks: [complaint] },
            { id: "pricing", status: "taken", checks: [pricing] },
            { id: "rest", status: "not_needed", checks: [] },
          ],
        },
        { stepId: "reply", status: "succeeded" },
        { stepId: "reply-approval", status: "failed" },
      ],
    };

    const view = graphView(triageWithApproval(), {
      action,
      insertedApprovals: ["reply-approval"],
      trace,
    });

    expect(view.tried).toBe(true);
    expect(flat(view.steps, (step) => step.run)).toEqual([
      ["kind", "taken"],
      ["details", "taken"],
      ["route", "taken"],
      ["to-person", "skipped"],
      ["reply", "taken"],
      ["reply-approval", "failed"],
    ]);
    expect(branchOf(view.steps[2]).map((path) => [path.id, path.run])).toEqual([
      ["complaint", { status: "not_taken", checks: [complaint] }],
      ["pricing", { status: "taken", checks: [pricing] }],
      ["rest", { status: "not_needed", checks: [] }],
    ]);
  });

  it("draws a proposal as its changes: new, removed where they stood, and changed with what was before", () => {
    const current = triageWithApproval();
    const proposed = structuredClone(current);
    const kind = proposed.steps[0];
    const route = proposed.steps[2];
    if (kind.type !== "classify" || route.type !== "branch") throw new Error("triage shape");
    kind.question = "What is this message about?";
    const [complaint, pricing] = route.paths;
    complaint.condition.checks = [{ classify: "kind", is: "complaint", minP: 0.7 }];
    complaint.steps = [
      { id: "tag", type: "tool", action: "google-mail.add-label", input: { label: "Complaints" } },
    ];
    route.paths = [
      complaint,
      pricing,
      {
        id: "refund",
        name: "Refund",
        condition: { combine: "all", checks: [{ classify: "kind", is: "other", minP: 0.5 }] },
        steps: [{ id: "to-billing", type: "escalate", reason: "Billing handles refunds." }],
      },
    ];

    const view = graphView(current, {
      action,
      insertedApprovals: ["reply-approval"],
      proposal: { spec: proposed, insertedApprovals: ["reply-approval"] },
    });

    expect(flat(view.steps, (step) => step.change)).toEqual([
      ["kind", "changed"],
      ["details", null],
      // A branch is changed by its own fields, not its paths, which carry their own marks.
      ["route", null],
      ["tag", "added"],
      ["to-person", "removed"],
      ["reply", null],
      ["reply-approval", null],
      ["to-billing", "added"],
    ]);
    expect(view.steps[0]?.before).toBe(
      'Asks "What kind of message is this?" and picks one of: complaint, pricing, other.',
    );
    expect(branchOf(view.steps[2]).map((path) => [path.id, path.change, path.before])).toEqual([
      ["complaint", "changed", '"kind" says "complaint" with at least 80% confidence'],
      ["pricing", null, null],
      ["refund", "added", null],
      ["rest", null, null],
    ]);
  });

  it("names what a changed path's condition tested before in plain words", () => {
    const current = triageWithApproval();
    const proposed = structuredClone(current);
    const route = proposed.steps[2];
    if (route.type !== "branch") throw new Error("triage shape");
    route.paths[1].condition.checks = [
      { subject: { from: "trigger.senderDomain" }, op: "is", value: "acme.test" },
    ];

    const view = graphView(current, { action, proposal: { spec: proposed } });

    const pricing = branchOf(view.steps[2]).at(1);
    expect([pricing?.condition, pricing?.before]).toEqual([
      `the sender's domain is "acme.test"`,
      '"kind" says "pricing" with at least 85% confidence or what they ask about contains "Chair"',
    ]);
  });

  it("draws a removed path, its steps struck through, where it stood", () => {
    const current = triageWithApproval();
    const proposed = structuredClone(current);
    const route = proposed.steps[2];
    if (route.type !== "branch") throw new Error("triage shape");
    route.paths = route.paths.slice(1);

    const view = graphView(current, { proposal: { spec: proposed } });

    const paths = branchOf(view.steps[2]);
    expect(paths.map((path) => [path.id, path.change])).toEqual([
      ["complaint", "removed"],
      ["pricing", null],
      ["rest", null],
    ]);
    expect(paths[0]?.steps.map((step) => [step.id, step.change])).toEqual([
      ["to-person", "removed"],
    ]);
  });

  it("draws a step moved off a removed path only where it went", () => {
    const current = triageWithApproval();
    const proposed = structuredClone(current);
    const route = proposed.steps[2];
    if (route.type !== "branch") throw new Error("triage shape");
    const [complaint, pricing] = route.paths;
    route.paths = [pricing];
    route.otherwise.steps = complaint.steps;

    const view = graphView(current, { proposal: { spec: proposed } });

    const paths = branchOf(view.steps[2]);
    expect(paths.map((path) => [path.id, path.change, path.steps.map((step) => step.id)])).toEqual([
      ["complaint", "removed", []],
      ["pricing", null, ["reply", "reply-approval"]],
      ["rest", null, ["to-person"]],
    ]);
    // Marked as the diff marks it where it went.
    expect(paths[2].steps[0].change).toBe("added");
  });

  it("draws a new workflow's proposal as all new, and no workflow as no steps", () => {
    const view = graphView(null, { proposal: { spec: triageWithApproval() } });

    expect(flat(view.steps, (step) => step.change).every(([, mark]) => mark === "added")).toBe(
      true,
    );
    expect(branchOf(view.steps[2]).every((path) => path.change === "added")).toBe(true);
    expect(graphView(null).steps).toEqual([]);
  });

  it("leaves a path the Try it never reached without a status, and draws nothing lit untried", () => {
    const trace: GraphTrace = { steps: [{ stepId: "kind", status: "failed" }] };

    const tried = graphView(triageWithApproval(), { trace });
    const untried = graphView(triageWithApproval());

    expect(flat(tried.steps, (step) => step.run).slice(0, 3)).toEqual([
      ["kind", "failed"],
      ["details", "skipped"],
      ["route", "skipped"],
    ]);
    expect(branchOf(tried.steps[2]).map((path) => path.run)).toEqual([null, null, null]);
    expect(untried.tried).toBe(false);
    expect(flat(untried.steps, (step) => step.run).every(([, run]) => run === null)).toBe(true);
  });
});
