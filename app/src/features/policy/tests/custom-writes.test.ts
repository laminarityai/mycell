// A custom write waits for a person each time it runs (ADR-0018, ADR-0019): a tool step may use
// one, and the engine inserts a `held_send` approval right after it when nothing on its own path
// reviews it, by the same rule as Gmail drafts.
import { describe, expect, it } from "vitest";
import {
  checkedCustomAction,
  readOutlookMessage,
  replyToOutlookMessage,
} from "@/db/testing/custom-actions";
import { actionSetWith } from "@/features/custom-actions/description";
import { findStep } from "@/features/spec/tree";
import { applyPolicy } from "../engine";
import { specWithSteps } from "./specs";

const actions = actionSetWith([
  checkedCustomAction(readOutlookMessage()),
  checkedCustomAction(replyToOutlookMessage()),
]);

const reply = {
  id: "reply",
  type: "tool",
  action: "microsoft.reply-to-message",
  input: { messageId: "AAMk-1", comment: "Thanks, on its way." },
};

describe("a custom write in a tool step", () => {
  it("gets a held_send approval inserted right after it", () => {
    const result = applyPolicy(specWithSteps([reply]), actions);

    expect(result).toMatchObject({
      ok: true,
      maxRisk: "external_send",
      inserted: [
        { stepId: "reply-approval", after: "reply", action: "microsoft.reply-to-message" },
      ],
    });
    if (!result.ok) return;
    expect(result.spec.steps.map((step) => step.id)).toEqual(["reply", "reply-approval"]);
    expect(findStep(result.spec, "reply-approval")).toEqual({
      id: "reply-approval",
      type: "approval",
      channel: "held_send",
    });
  });

  it("needs nothing inserted when a held_send approval follows it on its path", () => {
    const spec = specWithSteps([reply, { id: "check", type: "approval", channel: "held_send" }]);

    expect(applyPolicy(spec, actions)).toMatchObject({ ok: true, spec, inserted: [] });
  });

  it("isn't reviewed by an approval of Gmail drafts", () => {
    const spec = specWithSteps([reply, { id: "check", type: "approval", channel: "gmail_drafts" }]);

    const result = applyPolicy(spec, actions);

    expect(result).toMatchObject({ ok: true, inserted: [{ stepId: "reply-approval" }] });
    if (!result.ok) return;
    expect(result.spec.steps.map((step) => step.id)).toEqual(["reply", "reply-approval", "check"]);
  });

  it("can't be a draft step's output", () => {
    const spec = specWithSteps([
      {
        id: "draft",
        type: "draft",
        role: "smart",
        instructions: "Reply.",
        output: "microsoft.reply-to-message",
      },
    ]);

    expect(applyPolicy(spec, actions)).toEqual({
      ok: false,
      issues: [
        {
          path: ["steps", 0, "output"],
          message: `"microsoft.reply-to-message" doesn't create a draft; use it in a tool step.`,
        },
      ],
    });
  });

  it("leaves a custom read to run on its own", () => {
    const spec = specWithSteps([
      { id: "read", type: "tool", action: "microsoft.read-message", input: { messageId: "m" } },
    ]);

    expect(applyPolicy(spec, actions)).toMatchObject({ ok: true, maxRisk: "read", inserted: [] });
  });
});
