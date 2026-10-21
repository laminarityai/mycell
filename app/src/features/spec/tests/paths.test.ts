import { describe, expect, it } from "vitest";
import { validateSpec } from "../validate";
import { pathOf, triageSpec, triageWithPaths } from "./triage-spec";

const pricing = { classify: "kind", is: "pricing", minP: 0.5 };
const value = (from: string, op: string, compared?: string | number) => ({
  subject: { from },
  op,
  ...(compared === undefined ? {} : { value: compared }),
});
const escalate = (id: string) => ({ id, type: "escalate", reason: "A person looks." });

/** A branch `id` with one path checking `pricing`, holding `steps`, and an empty otherwise. */
function branchOf(id: string, steps: unknown[] = [], checks: unknown[] = [pricing]) {
  return {
    id,
    type: "branch",
    paths: [pathOf(`${id}-path`, checks, steps)],
    otherwise: { id: `${id}-otherwise`, steps: [] },
  };
}

describe("validateSpec on a branch with several paths", () => {
  it("accepts a first-match branch that hands complaints over and drafts pricing replies", () => {
    const spec = triageSpec();

    expect(validateSpec(spec)).toEqual({ ok: true, spec });
  });

  it("refuses a step that reads a step on a sibling path, at the nested field", () => {
    const spec = triageWithPaths([
      pathOf("first", [pricing], [{ ...escalate("hand-over") }]),
      pathOf("second", [pricing], [{ ...escalate("hand-over-2") }, branchOf("inner")]),
      pathOf(
        "third",
        [pricing],
        [
          {
            id: "label",
            type: "tool",
            action: "google-mail.add-label",
            input: { messageId: { from: "trigger.messageId" }, label: { from: "inner.x" } },
          },
          branchOf("late", [], [value("hand-over.reason", "is_empty")]),
        ],
      ),
    ]);

    expect(issuePaths(spec)).toEqual([
      ["steps", 2, "paths", 2, "steps", 0, "input", "label", "from"],
      ["steps", 2, "paths", 2, "steps", 1, "paths", 0, "condition", "checks", 0, "subject", "from"],
    ]);
  });

  it("checks an extract step's fields with the operators that fit each field's type", () => {
    const fits = [
      value("details.product", "starts_with", "oak"),
      value("details.total", "at_least", 1000),
      value("details.urgent", "is_yes"),
      value("details.product", "is_empty"),
      value("details.total", "is_not_empty"),
    ];
    const misfits = [
      value("details.total", "contains", "1"),
      value("details.product", "more_than", 3),
      value("details.urgent", "is", "yes"),
      value("details.product", "is_no"),
    ];

    expect(validateSpec(triageWithPaths([pathOf("fits", fits)]))).toMatchObject({ ok: true });
    const at = (c: number) => ["steps", 2, "paths", 0, "condition", "checks", c, "op"];
    expect(issuePaths(triageWithPaths([pathOf("misfits", misfits)]))).toEqual([
      at(0),
      at(1),
      at(2),
      at(3),
    ]);
    expect(validateSpec(triageWithPaths([pathOf("misfits", misfits.slice(0, 1))]))).toMatchObject({
      issues: [{ message: 'details.total is a number, so "contains" can\'t check it.' }],
    });
  });

  it("refuses a check on a field the extract lacks, a classify step's label, or an undeclared fact", () => {
    const spec = triageWithPaths([
      pathOf("checks", [
        value("details.city", "is_empty"),
        value("kind.label", "is", "pricing"),
        value("trigger.body", "contains", "quote"),
      ]),
    ]);

    const at = (c: number) => ["steps", 2, "paths", 0, "condition", "checks", c, "subject", "from"];
    expect(issuePaths(spec)).toEqual([at(0), at(1), at(2)]);
  });

  it("refuses a path with no checks, and more than 10 paths, not counting otherwise", () => {
    const ten = Array.from({ length: 10 }, (_, i) => pathOf(`p${String(i)}`, [pricing]));

    expect(validateSpec(triageWithPaths(ten))).toMatchObject({ ok: true });
    expect(issuePaths(triageWithPaths([pathOf("empty", [])]))).toEqual([
      ["steps", 2, "paths", 0, "condition", "checks"],
    ]);
    expect(issuePaths(triageWithPaths([...ten, pathOf("p10", [pricing])]))).toEqual([
      ["steps", 2, "paths"],
    ]);
  });

  it("refuses a step after a branch in its list, since paths never join", () => {
    const spec = triageSpec();
    spec.steps.push(escalate("after"));

    expect(issuePaths(spec)).toEqual([["steps", 3]]);
  });

  it("nests branches 3 deep, and refuses a fourth, at the branch too deep", () => {
    const deep = (levels: number): unknown =>
      levels === 1 ? branchOf("b1") : branchOf(`b${String(levels)}`, [deep(levels - 1)]);
    const spec = (levels: number) => {
      const base = triageSpec();
      base.steps[2] = deep(levels) as Record<string, unknown>;
      return base;
    };

    expect(validateSpec(spec(3))).toMatchObject({ ok: true });
    const fourth = ["steps", 2, "paths", 0, "steps", 0, "paths", 0, "steps", 0, "paths", 0];
    expect(issuePaths(spec(4))).toEqual([[...fourth, "steps", 0]]);
  });
});

describe("validateSpec on an every-match branch", () => {
  const draft = (id: string) => ({
    id,
    type: "draft",
    role: "smart",
    instructions: "Reply with our current prices.",
    context: ["trigger.message"],
    output: "google-mail.create-draft",
  });
  const everyMatch = (paths: unknown[], otherwise: unknown[] = []) => {
    const spec = triageWithPaths(paths);
    spec.steps[2] = {
      ...spec.steps[2],
      mode: "every",
      otherwise: { id: "rest", steps: otherwise },
    };
    return spec;
  };

  it("accepts a draft and an escalation side by side, two drafts on one path, and one on otherwise", () => {
    const spec = everyMatch(
      [
        pathOf("pricing", [pricing], [draft("reply"), draft("follow-up")]),
        pathOf("complaint", [pricing], [escalate("hand-over")]),
      ],
      [draft("fallback"), escalate("fallback-hand-over")],
    );

    expect(validateSpec(spec)).toMatchObject({ ok: true });
  });

  it("accepts two drafts on two paths of a first-match branch, since only one runs", () => {
    const spec = triageWithPaths([
      pathOf("pricing", [pricing], [draft("reply")]),
      pathOf("quote", [pricing], [draft("quote-reply")]),
    ]);

    expect(validateSpec(spec)).toMatchObject({ ok: true });
  });

  it("refuses two drafts that can run together, at the later one, nested or not", () => {
    const spec = everyMatch([
      pathOf("pricing", [pricing], [draft("reply")]),
      pathOf("label", [pricing], [escalate("hand-over")]),
      pathOf("quote", [pricing], [branchOf("size", [draft("quote-reply")])]),
    ]);

    const result = validateSpec(spec);
    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          path: ["steps", 2, "paths", 2, "steps", 0, "paths", 0, "steps", 0],
          message:
            '"quote-reply" and "reply" can both run, since the branch runs every path that applies, and each drafts a reply. Put them on one path, or make the branch run the first path that applies.',
        },
      ],
    });
  });

  it("refuses two escalations that can run together", () => {
    const spec = everyMatch([
      pathOf("complaint", [pricing], [escalate("hand-over")]),
      pathOf("urgent", [pricing], [escalate("urgent-hand-over")]),
    ]);

    expect(validateSpec(spec)).toMatchObject({
      ok: false,
      issues: [
        {
          path: ["steps", 2, "paths", 1, "steps", 0],
          message:
            '"urgent-hand-over" and "hand-over" can both run, since the branch runs every path that applies, and each hands the message to a person. Put them on one path, or make the branch run the first path that applies.',
        },
      ],
    });
  });

  it("refuses two drafts under a nested every-match branch, whose nearest shared branch it is", () => {
    const inner = {
      ...branchOf("inner"),
      mode: "every",
      paths: [
        pathOf("a", [pricing], [draft("a-reply")]),
        pathOf("b", [pricing], [draft("b-reply")]),
      ],
    };
    const spec = triageWithPaths([pathOf("pricing", [pricing], [inner])]);

    expect(issuePaths(spec)).toEqual([
      ["steps", 2, "paths", 0, "steps", 0, "paths", 1, "steps", 0],
    ]);
  });
});

function issuePaths(spec: unknown) {
  const result = validateSpec(spec);
  if (result.ok) throw new Error("expected the spec to be refused");
  return result.issues.map((issue) => issue.path);
}
