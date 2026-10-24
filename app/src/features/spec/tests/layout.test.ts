import { describe, expect, it } from "vitest";
import { graphView } from "../graph";
import { boxLabel, layoutTree, type LayoutNode } from "../layout";
import type { Spec } from "../types";
import { validateSpec } from "../validate";
import { pathOf, triageSpec, triageWithPaths } from "./triage-spec";

function parsed(input: unknown): Spec {
  const result = validateSpec(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.spec;
}

const BIG = { subject: { from: "details.total" }, op: "more_than", value: 1000 };
const URGENT = { subject: { from: "details.urgent" }, op: "is_yes" };
const PRICING = { classify: "kind", is: "pricing", minP: 0.85 };

/**
 * Triage with a branch inside a branch: complaints split again by order size, and a wide
 * pricing path whose own branch has three paths.
 */
function nestedSpec(): Spec {
  const escalate = (id: string) => ({ id, type: "escalate", reason: "A person looks." });
  return parsed(
    triageWithPaths([
      pathOf(
        "complaint",
        [{ classify: "kind", is: "complaint", minP: 0.8 }],
        [
          {
            id: "size",
            type: "branch",
            mode: "first",
            paths: [pathOf("big", [BIG], [escalate("to-manager")])],
            otherwise: { id: "small", steps: [escalate("to-support")] },
          },
        ],
      ),
      pathOf(
        "pricing",
        [PRICING],
        [
          {
            id: "how",
            type: "branch",
            mode: "first",
            paths: [
              pathOf("urgent", [URGENT], [escalate("to-sales")]),
              pathOf("large", [BIG], [escalate("to-director")]),
              pathOf("quote", [PRICING], [escalate("to-quotes")]),
            ],
            otherwise: { id: "pricing-rest", steps: [] },
          },
        ],
      ),
    ]),
  );
}

function byId(nodes: LayoutNode[], id: string): LayoutNode {
  const node = nodes.find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
}

function overlap(a: LayoutNode, b: LayoutNode): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The leftmost and rightmost edge of a path's subtree: its heading and everything under it. */
function span(nodes: LayoutNode[], pathId: string, under: string[]): [number, number] {
  const mine = nodes.filter(
    (node) => node.id === `path:${pathId}` || under.some((id) => node.id.endsWith(`:${id}`)),
  );
  return [Math.min(...mine.map((n) => n.x)), Math.max(...mine.map((n) => n.x + n.width))];
}

describe("layoutTree", () => {
  it("puts the trigger on top, then each step below the one before it", () => {
    const layout = layoutTree(graphView(parsed(triageSpec())));

    const [trigger, kind, details, route] = [
      "trigger",
      "step:kind",
      "step:details",
      "step:route",
    ].map((id) => byId(layout.nodes, id));
    expect(trigger.y).toBeLessThan(kind.y);
    expect(trigger.y + trigger.height).toBeLessThanOrEqual(kind.y);
    expect(kind.y + kind.height).toBeLessThanOrEqual(details.y);
    expect(details.y + details.height).toBeLessThanOrEqual(route.y);
    for (const edge of layout.edges) {
      const source = byId(layout.nodes, edge.source);
      const target = byId(layout.nodes, edge.target);
      expect(target.y).toBeGreaterThanOrEqual(source.y + source.height);
    }
  });

  it("lists its boxes in reading order, the order a keyboard reaches them in", () => {
    const layout = layoutTree(graphView(parsed(triageSpec())));

    expect(layout.nodes.map((node) => node.id)).toEqual([
      "trigger",
      "step:kind",
      "step:details",
      "step:route",
      "path:complaint",
      "step:to-person",
      "end:complaint",
      "path:pricing",
      "step:reply",
      "end:pricing",
      "path:rest",
      "end:rest",
    ]);
  });

  it("names each box but an end for a screen reader", () => {
    const { nodes } = layoutTree(graphView(parsed(triageSpec())));

    expect(
      ["trigger", "step:kind", "path:pricing", "path:rest", "end:pricing"].map((id) =>
        boxLabel(byId(nodes, id)),
      ),
    ).toEqual(["Trigger", "Step kind", "Path Pricing", "Path Otherwise", undefined]);
  });

  it("keeps a branch's paths side by side, left to right in the order they're checked", () => {
    const layout = layoutTree(graphView(nestedSpec()));

    const paths = ["path:complaint", "path:pricing", "path:rest"].map((id) =>
      byId(layout.nodes, id),
    );
    const xs = paths.map((path) => path.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(paths.map((path) => path.y)).size).toBe(1);
    const inner = ["path:urgent", "path:large", "path:quote", "path:pricing-rest"].map(
      (id) => byId(layout.nodes, id).x,
    );
    expect(inner).toEqual([...inner].sort((a, b) => a - b));
  });

  it("never overlaps two boxes, or two paths' subtrees", () => {
    const { nodes } = layoutTree(graphView(nestedSpec()));

    for (const [i, a] of nodes.entries()) {
      for (const b of nodes.slice(i + 1)) {
        expect(overlap(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
    const complaint = span(nodes, "complaint", [
      "size",
      "big",
      "small",
      "to-manager",
      "to-support",
    ]);
    const pricing = span(nodes, "pricing", [
      "how",
      "urgent",
      "large",
      "quote",
      "pricing-rest",
      "to-sales",
      "to-director",
      "to-quotes",
    ]);
    const rest = span(nodes, "rest", ["rest"]);
    expect(complaint[1]).toBeLessThanOrEqual(pricing[0]);
    expect(pricing[1]).toBeLessThanOrEqual(rest[0]);
  });

  it("gives the same positions for the same input, every time", () => {
    const first = layoutTree(graphView(nestedSpec()));
    const second = layoutTree(graphView(structuredClone(nestedSpec())));

    expect(second).toEqual(first);
    expect(Math.min(...first.nodes.map((node) => node.x))).toBe(0);
    expect(first.width).toBe(Math.max(...first.nodes.map((node) => node.x + node.width)));
  });

  it("ends each list: End under its last step, Stops here under an empty otherwise path", () => {
    const { nodes, edges } = layoutTree(graphView(nestedSpec()));

    const ends = nodes.flatMap((node) => (node.kind === "end" ? [[node.id, node.label]] : []));
    expect(ends).toContainEqual(["end:pricing-rest", "Stops here"]);
    expect(ends).toContainEqual(["end:rest", "Stops here"]);
    expect(ends).toContainEqual(["end:big", "End"]);
    expect(edges).toContainEqual(
      expect.objectContaining({ source: "step:to-manager", target: "end:big" }),
    );
  });

  it("says where each line adds a step: its list and the step before, past policy's reviews", () => {
    const spec = parsed(triageSpec());
    const branch = spec.steps[2];
    if (branch.type !== "branch") throw new Error("the triage spec has a branch");
    branch.paths[1].steps.push({ id: "reply-approval", type: "approval", channel: "gmail_drafts" });
    const view = graphView(spec, { insertedApprovals: ["reply-approval"] });

    const { edges } = layoutTree(view);

    const insert = (source: string, target: string) =>
      edges.find((edge) => edge.source === source && edge.target === target)?.insert;
    expect(insert("trigger", "step:kind")).toEqual({ list: "root", after: null });
    expect(insert("step:details", "step:route")).toEqual({ list: "root", after: "details" });
    expect(insert("step:route", "path:complaint")).toBeNull();
    expect(insert("path:complaint", "step:to-person")).toEqual({ list: "complaint", after: null });
    expect(insert("step:to-person", "end:complaint")).toEqual({
      list: "complaint",
      after: "to-person",
    });
    expect(insert("step:reply", "step:reply-approval")).toEqual({
      list: "pricing",
      after: "reply",
    });
    expect(insert("step:reply-approval", "end:pricing")).toEqual({
      list: "pricing",
      after: "reply",
    });
    expect(insert("path:rest", "end:rest")).toEqual({ list: "rest", after: null });
  });

  it("lights the lines a Try it's message took, and dims the rest", () => {
    const view = graphView(parsed(triageSpec()), {
      trace: {
        steps: [
          { stepId: "kind", status: "succeeded" },
          { stepId: "details", status: "succeeded" },
          {
            stepId: "route",
            status: "succeeded",
            paths: [
              { id: "complaint", status: "not_taken", checks: [] },
              { id: "pricing", status: "taken", checks: [] },
              { id: "rest", status: "not_needed", checks: [] },
            ],
          },
          { stepId: "reply", status: "succeeded" },
        ],
      },
    });

    const { edges, nodes } = layoutTree(view);

    const run = (source: string, target: string) =>
      edges.find((edge) => edge.source === source && edge.target === target)?.run;
    expect(run("trigger", "step:kind")).toBe("taken");
    expect(run("step:route", "path:pricing")).toBe("taken");
    expect(run("path:pricing", "step:reply")).toBe("taken");
    expect(run("step:route", "path:complaint")).toBe("skipped");
    expect(run("path:complaint", "step:to-person")).toBe("skipped");
    expect(byId(nodes, "end:pricing")).toMatchObject({ run: "taken" });
    expect(byId(nodes, "end:rest")).toMatchObject({ run: "skipped" });
  });
});
