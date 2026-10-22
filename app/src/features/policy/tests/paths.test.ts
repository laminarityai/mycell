import { describe, expect, it } from "vitest";
import { findStep } from "@/features/spec/tree";
import { catalogActionSet } from "../catalog";
import { applyPolicy, maxRisk } from "../engine";
import { parsedSpec } from "./specs";

const reply = (id: string) => ({
  id,
  type: "draft",
  role: "smart",
  instructions: "Reply with our current prices.",
  context: ["trigger.message"],
  output: "google-mail.create-draft",
});
const approval = (id: string) => ({ id, type: "approval", channel: "gmail_drafts" });
const label = {
  id: "label",
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label: "Seen" },
};
const isLabel = (is: string) => ({
  combine: "all",
  checks: [{ classify: "kind", is, minP: 0.8 }],
});

/** classify, then `before`, then a first-match branch with a pricing and a complaint path. */
function branching(pricing: unknown[], complaint: unknown[], before: unknown[] = []) {
  return parsedSpec({
    specVersion: 2,
    id: "triage",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    autonomy: { rung: 3 },
    steps: [
      {
        id: "kind",
        type: "classify",
        role: "classify",
        question: "What kind of message is this?",
        labels: ["pricing", "complaint"],
      },
      ...before,
      {
        id: "route",
        type: "branch",
        paths: [
          { id: "pricing", name: "Pricing", condition: isLabel("pricing"), steps: pricing },
          { id: "complaint", name: "Complaint", condition: isLabel("complaint"), steps: complaint },
        ],
        otherwise: { id: "rest", steps: [] },
      },
    ],
  });
}

const stepIdsOn = (spec: ReturnType<typeof branching>, pathId: string) => {
  const branch = findStep(spec, "route");
  if (branch?.type !== "branch") throw new Error("no branch");
  return branch.paths.find((path) => path.id === pathId)?.steps.map((step) => step.id);
};

describe("applyPolicy on a branch with several paths", () => {
  it("inserts the review on the draft's own path, where a sibling path's approval doesn't count", () => {
    const result = applyPolicy(
      branching([reply("reply")], [approval("approve")]),
      catalogActionSet,
    );
    if (!result.ok) throw new Error("expected the spec to pass");

    expect(result.inserted).toEqual([
      { stepId: "reply-approval", after: "reply", action: "google-mail.create-draft" },
    ]);
    expect(stepIdsOn(result.spec, "pricing")).toEqual(["reply", "reply-approval"]);
    expect(stepIdsOn(result.spec, "complaint")).toEqual(["approve"]);
  });

  it("counts only an approval after the draft in its own list", () => {
    const after = applyPolicy(
      branching([reply("reply"), label, approval("approve")], []),
      catalogActionSet,
    );

    expect(after).toMatchObject({ ok: true, inserted: [] });
  });

  it("doesn't count an approval above the draft, which ran before the draft was made", () => {
    const above = applyPolicy(
      branching([reply("reply")], [], [approval("approve")]),
      catalogActionSet,
    );
    const earlierInList = applyPolicy(
      branching([approval("approve"), reply("reply")], []),
      catalogActionSet,
    );

    expect(above).toMatchObject({ ok: true, inserted: [{ stepId: "reply-approval" }] });
    expect(earlierInList).toMatchObject({ ok: true, inserted: [{ stepId: "reply-approval" }] });
  });

  it("doesn't count an approval nested deeper than the draft, which a run may not reach", () => {
    const result = applyPolicy(branching([], [], [reply("reply")]), catalogActionSet);
    const nested = applyPolicy(
      branching([approval("approve")], [], [reply("reply")]),
      catalogActionSet,
    );

    expect(result).toMatchObject({ ok: true, inserted: [{ stepId: "reply-approval" }] });
    expect(nested).toMatchObject({ ok: true, inserted: [{ stepId: "reply-approval" }] });
  });

  it("takes the highest risk across every path", () => {
    expect(maxRisk(branching([], [label]), catalogActionSet)).toBe("internal_reversible");
    expect(maxRisk(branching([label], [reply("reply")]), catalogActionSet)).toBe("external_send");
  });
});
