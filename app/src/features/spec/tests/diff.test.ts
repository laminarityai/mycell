import { describe, expect, it } from "vitest";
import { diffSpecs, type StepDiff } from "../diff";
import type { Spec } from "../types";
import { validateSpec } from "../validate";
import { exampleSpec } from "./example-spec";
import { pathOf, triageSpec } from "./triage-spec";

function parsed(input: unknown): Spec {
  const result = validateSpec(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.spec;
}

/** The diff as indented lines, a path's lines under its branch and its steps under it. */
function outline(steps: StepDiff[], depth = 0): string[] {
  const pad = "  ".repeat(depth);
  return steps.flatMap((step) => [
    `${pad}${step.id} ${step.change}`,
    ...step.paths.flatMap((path) => [
      `${pad}  path ${path.id} ${path.change}`,
      ...outline(path.steps, depth + 2),
    ]),
    ...(step.otherwise === null
      ? []
      : [
          `${pad}  otherwise ${step.otherwise.id} ${step.otherwise.change}`,
          ...outline(step.otherwise.steps, depth + 2),
        ]),
  ]);
}

type Raw = Record<string, unknown>;

/** The triage spec's branch, to change its paths. */
function routeOf(spec: ReturnType<typeof triageSpec>): Raw & { paths: Raw[]; otherwise: Raw } {
  return spec.steps[2] as Raw & { paths: Raw[]; otherwise: Raw };
}

const escalate = (id: string) => ({ id, type: "escalate", reason: "A person decides." });

describe("diffSpecs", () => {
  it("marks every step and path added when there is no base spec", () => {
    const diff = diffSpecs(null, parsed(exampleSpec()));

    expect(outline(diff.steps)).toEqual([
      "classify added",
      "gate added",
      "  path gate-yes added",
      "    prices added",
      "    draft added",
      "    approve added",
      "  otherwise gate-otherwise added",
    ]);
    expect(diff.settings).toEqual([]);
  });

  it("pairs steps and paths by ID: changed, unchanged, removed where they stood, and added", () => {
    const proposed = triageSpec();
    const route = routeOf(proposed);
    const [complaint, pricing] = route.paths as [Raw, Raw & { steps: Raw[] }];
    route.paths = [
      // The complaint path's condition is stricter, and its step is gone.
      {
        ...complaint,
        condition: { combine: "all", checks: [{ classify: "kind", is: "complaint", minP: 0.9 }] },
        steps: [],
      },
      // A new path for big orders, before pricing.
      pathOf(
        "big",
        [{ subject: { from: "details.total" }, op: "more_than", value: 1000 }],
        [escalate("big-to-person")],
      ),
      { ...pricing, steps: [{ ...pricing.steps[0], instructions: "Reply kindly." }] },
    ];
    route.otherwise = { id: "rest", steps: [escalate("rest-to-person")] };
    proposed.credentials = "org";

    const diff = diffSpecs(parsed(triageSpec()), parsed(proposed));

    expect(outline(diff.steps)).toEqual([
      "kind unchanged",
      "details unchanged",
      "route unchanged",
      "  path complaint changed",
      "    to-person removed",
      "  path big added",
      "    big-to-person added",
      "  path pricing unchanged",
      "    reply changed",
      "  otherwise rest unchanged",
      "    rest-to-person added",
    ]);
    const path = diff.steps.at(2)?.paths.at(0);
    expect(path?.before?.condition.checks).toEqual([
      { classify: "kind", is: "complaint", minP: 0.8 },
    ]);
    expect(path?.after?.condition.checks).toEqual([
      { classify: "kind", is: "complaint", minP: 0.9 },
    ]);
    expect(diff.settings).toEqual(["credentials"]);
  });

  it("marks a branch changed for its own fields, not for a change to one of its paths", () => {
    const renamed = triageSpec();
    const route = routeOf(renamed);
    route.paths = route.paths.map((path) =>
      path.id === "pricing" ? { ...path, name: "Prices" } : path,
    );
    const base = parsed(triageSpec());
    // Set after validation, which refuses every match until runs can take several paths.
    const everyMatch = {
      ...base,
      steps: base.steps.map((step) => (step.type === "branch" ? { ...step, mode: "every" } : step)),
    } as Spec;

    expect(outline(diffSpecs(base, parsed(renamed)).steps).slice(2, 6)).toEqual([
      "route unchanged",
      "  path complaint unchanged",
      "    to-person unchanged",
      "  path pricing changed",
    ]);
    expect(diffSpecs(base, everyMatch).steps.at(2)?.change).toBe("changed");
  });

  it("shows a removed path where it stood, its steps removed with it", () => {
    const proposed = triageSpec();
    const route = routeOf(proposed);
    route.paths = route.paths.filter((path) => path.id !== "complaint");

    const diff = diffSpecs(parsed(triageSpec()), parsed(proposed));

    expect(outline(diff.steps).slice(2)).toEqual([
      "route unchanged",
      "  path complaint removed",
      "    to-person removed",
      "  path pricing unchanged",
      "    reply unchanged",
      "  otherwise rest unchanged",
    ]);
  });

  it("shows a step moved to another path as removed from one and added on the other", () => {
    const proposed = triageSpec();
    const route = routeOf(proposed);
    const [complaint] = route.paths as [Raw & { steps: Raw[] }];
    route.paths = route.paths.map((path) => (path === complaint ? { ...path, steps: [] } : path));
    route.otherwise = { id: "rest", steps: complaint.steps };

    const diff = diffSpecs(parsed(triageSpec()), parsed(proposed));

    expect(outline(diff.steps).slice(3)).toEqual([
      "  path complaint unchanged",
      "    to-person removed",
      "  path pricing unchanged",
      "    reply unchanged",
      "  otherwise rest unchanged",
      "    to-person added",
    ]);
  });

  it("ignores key order, as jsonb shuffles it", () => {
    const base = parsed(triageSpec());
    const shuffled = JSON.parse(JSON.stringify(base), (_key, value: unknown) =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ) as Spec;

    expect(
      outline(diffSpecs(base, shuffled).steps).every((line) => line.endsWith("unchanged")),
    ).toBe(true);
  });
});
