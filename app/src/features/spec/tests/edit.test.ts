import { describe, expect, it } from "vitest";
import {
  addPath,
  insertStep,
  movePath,
  removePath,
  removeStep,
  setBranchMode,
  updatePath,
  updateStep,
} from "../edit";
import { newPath, newStep } from "../new-step";
import { findStep } from "../tree";
import type { Path, Spec, Step } from "../types";
import { validateSpec } from "../validate";
import { triageSpec } from "./triage-spec";

function parsed(input: unknown): Spec {
  const result = validateSpec(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.spec;
}

const escalate = (id: string): Step => ({ id, type: "escalate", reason: "A person looks." });

/** Each list's step IDs, the root's and every path's, keyed by the list's ID. */
function lists(spec: Spec): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (listId: string, steps: Step[]) => {
    out[listId] = steps.map((step) => step.id);
    for (const step of steps) {
      if (step.type !== "branch") continue;
      for (const path of step.paths) walk(path.id, path.steps);
      walk(step.otherwise.id, step.otherwise.steps);
    }
  };
  walk("root", spec.steps);
  return out;
}

describe("insertStep", () => {
  it("puts a step into the root list after the step it names, or first", () => {
    const spec = parsed(triageSpec());

    expect(lists(insertStep(spec, { list: "root", after: "kind" }, escalate("look")))).toEqual(
      expect.objectContaining({ root: ["kind", "look", "details", "route"] }),
    );
    expect(insertStep(spec, { list: "root", after: null }, escalate("look")).steps[0]?.id).toBe(
      "look",
    );
    expect(lists(spec).root).toEqual(["kind", "details", "route"]);
  });

  it("puts a step onto a path, or onto an otherwise path", () => {
    const spec = parsed(triageSpec());

    const edited = insertStep(
      insertStep(spec, { list: "pricing", after: "reply" }, escalate("look")),
      { list: "rest", after: null },
      escalate("anyone"),
    );

    expect(lists(edited)).toEqual({
      root: ["kind", "details", "route"],
      complaint: ["to-person"],
      pricing: ["reply", "look"],
      rest: ["anyone"],
    });
  });

  it("moves the steps below a new branch onto its otherwise path, keeping what it had", () => {
    const spec = parsed(triageSpec());
    const branch: Step = {
      id: "size",
      type: "branch",
      mode: "first",
      paths: [
        {
          id: "big",
          name: "Big",
          condition: {
            combine: "all",
            checks: [{ subject: { from: "details.total" }, op: "more_than", value: 1000 }],
          },
          steps: [],
        },
      ],
      otherwise: { id: "small", steps: [escalate("first")] },
    };

    const edited = insertStep(spec, { list: "root", after: "details" }, branch);

    expect(lists(edited)).toEqual({
      root: ["kind", "details", "size"],
      big: [],
      small: ["first", "route"],
      complaint: ["to-person"],
      pricing: ["reply"],
      rest: [],
    });
    expect(validateSpec(edited).ok).toBe(true);
  });
});

describe("newStep and newPath", () => {
  it("makes each kind of step with an ID no step or path has, valid as it's inserted", () => {
    let spec = parsed(triageSpec());
    let after = "reply";
    for (const kind of ["classify", "extract", "draft", "escalate", "classify"] as const) {
      const at = { list: "pricing", after };
      const step = newStep(spec, at, { type: kind });
      spec = insertStep(spec, at, step);
      after = step.id;
    }
    const at = { list: "rest", after: null };
    spec = insertStep(spec, at, newStep(spec, at, { type: "escalate" }));

    expect(lists(spec)).toMatchObject({
      pricing: ["reply", "classify", "extract", "draft", "escalate", "classify-2"],
      rest: ["escalate-2"],
    });
    expect(validateSpec(spec)).toMatchObject({ ok: true });
  });

  it("names a tool step for its action, with the action's inputs blank", () => {
    const spec = parsed(triageSpec());
    const at = { list: "root", after: "details" };

    const step = newStep(spec, at, {
      type: "tool",
      action: "google-mail.add-label",
      inputs: ["messageId", "label"],
    });

    expect(step).toEqual({
      id: "add-label",
      type: "tool",
      action: "google-mail.add-label",
      input: { messageId: { from: "trigger.messageId" }, label: "" },
    });
  });

  it("starts a new branch's path on the nearest classify answer above it", () => {
    const spec = parsed(triageSpec());
    const at = { list: "pricing", after: "reply" };

    const branch = newStep(spec, at, { type: "branch" });

    expect(branch).toEqual({
      id: "branch",
      type: "branch",
      mode: "first",
      paths: [
        {
          id: "path",
          name: "Path 1",
          condition: { combine: "all", checks: [{ classify: "kind", is: "complaint", minP: 0.8 }] },
          steps: [],
        },
      ],
      otherwise: { id: "otherwise", steps: [] },
    });
    expect(validateSpec(insertStep(spec, at, branch)).ok).toBe(true);
  });

  it("starts a path on the trigger's subject when no classify step is above it", () => {
    const spec = parsed({ ...triageSpec(), steps: [escalate("first")] });
    const at = { list: "root", after: null };

    const branch = newStep(spec, at, { type: "branch" });

    expect(branch.type === "branch" && branch.paths[0]?.condition.checks).toEqual([
      { subject: { from: "trigger.subject" }, op: "contains", value: "" },
    ]);
  });

  it("makes a new path for a branch, named and numbered after its others", () => {
    const spec = parsed(triageSpec());

    const path = newPath(spec, "route");

    expect(path).toEqual({
      id: "path",
      name: "Path 3",
      condition: { combine: "all", checks: [{ classify: "kind", is: "complaint", minP: 0.8 }] },
      steps: [],
    });
    expect(validateSpec(addPath(spec, "route", path)).ok).toBe(true);
  });
});

describe("updateStep and removeStep", () => {
  it("changes the step with that ID wherever it is, and nothing else", () => {
    const spec = parsed(triageSpec());

    const edited = updateStep(spec, "reply", (step) =>
      step.type === "draft" ? { ...step, instructions: "Quote the price list." } : step,
    );

    expect(findStep(edited, "reply")).toMatchObject({ instructions: "Quote the price list." });
    expect(findStep(spec, "reply")).toMatchObject({
      instructions: "Reply with our current prices.",
    });
    expect(edited.steps[0]).toBe(spec.steps[0]);
  });

  it("removes a step wherever it is, a branch with everything on its named paths", () => {
    const spec = parsed(triageSpec());

    expect(lists(removeStep(spec, "to-person"))).toEqual({
      root: ["kind", "details", "route"],
      complaint: [],
      pricing: ["reply"],
      rest: [],
    });
    expect(lists(removeStep(spec, "route"))).toEqual({ root: ["kind", "details"] });
  });

  it("keeps a removed branch's otherwise steps, moved back where the branch stood", () => {
    const spec = parsed(triageSpec());
    const withRest = insertStep(spec, { list: "rest", after: null }, escalate("anyone"));

    expect(lists(removeStep(withRest, "route"))).toEqual({ root: ["kind", "details", "anyone"] });
  });

  it("gives back the same spec when a branch is inserted and then removed", () => {
    const spec = parsed(triageSpec());
    const at = { list: "root", after: "details" };
    const branch = newStep(spec, at, { type: "branch" });

    const edited = removeStep(insertStep(spec, at, branch), branch.id);

    expect(edited).toEqual(spec);
  });
});

describe("editing paths", () => {
  const pathIds = (spec: Spec) => {
    const branch = findStep(spec, "route");
    return branch?.type === "branch" ? branch.paths.map((path) => path.id) : [];
  };
  const urgent: Path = {
    id: "urgent",
    name: "Urgent",
    condition: {
      combine: "all",
      checks: [{ subject: { from: "details.urgent" }, op: "is_yes" }],
    },
    steps: [escalate("rush")],
  };

  it("adds a path last, before otherwise, and removes one", () => {
    const spec = parsed(triageSpec());

    const added = addPath(spec, "route", urgent);

    expect(pathIds(added)).toEqual(["complaint", "pricing", "urgent"]);
    expect(validateSpec(added).ok).toBe(true);
    expect(pathIds(removePath(added, "complaint"))).toEqual(["pricing", "urgent"]);
    expect(findStep(removePath(added, "complaint"), "to-person")).toBeUndefined();
  });

  it("moves a path left or right, and not past either end", () => {
    const spec = addPath(parsed(triageSpec()), "route", urgent);

    expect(pathIds(movePath(spec, "urgent", -1))).toEqual(["complaint", "urgent", "pricing"]);
    expect(pathIds(movePath(spec, "complaint", 1))).toEqual(["pricing", "complaint", "urgent"]);
    expect(movePath(spec, "complaint", -1)).toBe(spec);
    expect(movePath(spec, "urgent", 1)).toBe(spec);
  });

  it("changes a path's name and condition", () => {
    const spec = parsed(triageSpec());

    const edited = updatePath(spec, "pricing", (path) => ({
      ...path,
      name: "Prices",
      condition: { ...path.condition, combine: "all" },
    }));

    const branch = findStep(edited, "route");
    expect(branch?.type === "branch" && branch.paths[1]).toMatchObject({
      name: "Prices",
      condition: { combine: "all" },
      steps: [{ id: "reply" }],
    });
  });

  it("sets a branch's mode", () => {
    const spec = parsed(triageSpec());

    expect(findStep(setBranchMode(spec, "route", "every"), "route")).toMatchObject({
      mode: "every",
    });
  });
});
