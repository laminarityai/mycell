// Places the graph's view model top to bottom: a small tidy-tree layout. A workflow's paths
// never join, so it's a tree: each list of steps is a column, and a branch's paths sit side by
// side under it, left to right in the order they're checked, each as wide as what's under it.
// Box sizes follow from what a box shows, so the same view always gets the same positions.
// Pure, so client code may import it.
import type { GraphPath, GraphStep, GraphView } from "./graph";

export const STEP_WIDTH = 272;
export const PATH_WIDTH = 248;
const TRIGGER_HEIGHT = 76;
const END_HEIGHT = 28;
const END_WIDTH = 72;
const STOPS_WIDTH = 112;
/** Space between a box and the next one down, and between two paths side by side. */
const ROW_GAP = 40;
const COLUMN_GAP = 28;

/** A Try it's mark on a box or line: it ran, or the message never came this way. */
export type LayoutRun = "taken" | "skipped" | null;

type Box = { id: string; x: number; y: number; width: number; height: number };

export type LayoutNode<Risk extends string = string> = Box &
  (
    | { kind: "trigger"; run: LayoutRun }
    | { kind: "step"; step: GraphStep<Risk> }
    | { kind: "path"; path: GraphPath<Risk>; mode: "first" | "every" }
    | { kind: "end"; label: "End" | "Stops here"; run: LayoutRun; removed: boolean }
  );

export type LayoutEdge = {
  id: string;
  source: string;
  target: string;
  run: LayoutRun;
  /** It leads to something a proposal removes. */
  removed: boolean;
};

export type GraphLayout<Risk extends string = string> = {
  nodes: LayoutNode<Risk>[];
  edges: LayoutEdge[];
  width: number;
  height: number;
};

/** A step box's height: heading, two lines of text, then what it was and its badges. */
export function stepHeight(step: GraphStep): number {
  const badges = step.risk !== null || step.review !== null;
  return 80 + (badges ? 24 : 0) + (step.before === null ? 0 : 20);
}

/**
 * A path heading's height: its name, its condition (two lines; the otherwise path's one), what
 * it was, and a Try it's checks.
 */
export function pathHeight(path: GraphPath): number {
  const condition = path.name === null ? 18 : 34;
  const run = path.run === null ? 0 : 20 + path.run.checks.length * 32;
  return 36 + condition + (path.before === null ? 0 : 20) + run;
}

export function layoutTree<Risk extends string>(view: GraphView<Risk>): GraphLayout<Risk> {
  const nodes: LayoutNode<Risk>[] = [];
  const edges: LayoutEdge[] = [];
  const tried = view.tried;
  const runOf = (ran: boolean): LayoutRun => (tried ? (ran ? "taken" : "skipped") : null);
  const connect = (source: Placed, target: Placed) => {
    edges.push({
      id: `${source.id}->${target.id}`,
      source: source.id,
      target: target.id,
      run: tried ? (source.ran && target.ran ? "taken" : "skipped") : null,
      removed: target.removed,
    });
  };

  // Each list is a column centred on `center`, starting at `top`, under `from`.
  const placeList = (
    steps: GraphStep<Risk>[],
    center: number,
    top: number,
    from: Placed,
    end: EndOf,
  ) => {
    let previous = from;
    let y = top;
    for (const step of steps) {
      const height = stepHeight(step);
      const node: LayoutNode<Risk> = {
        kind: "step",
        id: `step:${step.id}`,
        x: center - STEP_WIDTH / 2,
        y,
        width: STEP_WIDTH,
        height,
        step,
      };
      nodes.push(node);
      const placed = { id: node.id, ran: ranStep(step), removed: step.change === "removed" };
      connect(previous, placed);
      previous = placed;
      y += height + ROW_GAP;
      // A branch ends its list: its paths go on side by side.
      if (step.branch !== null) {
        placePaths(step.branch.paths, step.branch.mode, center, y, placed);
        return;
      }
    }
    const label = end.stops && steps.length === 0 ? "Stops here" : "End";
    const width = label === "End" ? END_WIDTH : STOPS_WIDTH;
    const node: LayoutNode<Risk> = {
      kind: "end",
      id: `end:${end.listId}`,
      x: center - width / 2,
      y,
      width,
      height: END_HEIGHT,
      label,
      run: runOf(previous.ran),
      removed: previous.removed,
    };
    nodes.push(node);
    connect(previous, { id: node.id, ran: previous.ran, removed: previous.removed });
  };

  const placePaths = (
    paths: GraphPath<Risk>[],
    mode: "first" | "every",
    center: number,
    top: number,
    from: Placed,
  ) => {
    const widths = paths.map(pathWidth);
    const row = widths.reduce((sum, width) => sum + width, 0) + COLUMN_GAP * (paths.length - 1);
    const headings = Math.max(...paths.map(pathHeight));
    let left = center - row / 2;
    paths.forEach((path, index) => {
      const column = left + (widths[index] ?? 0) / 2;
      left += (widths[index] ?? 0) + COLUMN_GAP;
      const node: LayoutNode<Risk> = {
        kind: "path",
        id: `path:${path.id}`,
        x: column - PATH_WIDTH / 2,
        y: top,
        width: PATH_WIDTH,
        height: pathHeight(path),
        path,
        mode,
      };
      nodes.push(node);
      const ran = from.ran && path.run?.status === "taken";
      const placed = { id: node.id, ran, removed: path.change === "removed" };
      connect(from, placed);
      const end = { listId: path.id, stops: path.name === null };
      placeList(path.steps, column, top + headings + ROW_GAP, placed, end);
    });
  };

  const width = Math.max(STEP_WIDTH, listWidth(view.steps));
  const trigger: LayoutNode<Risk> = {
    kind: "trigger",
    id: "trigger",
    x: width / 2 - STEP_WIDTH / 2,
    y: 0,
    width: STEP_WIDTH,
    height: TRIGGER_HEIGHT,
    run: runOf(true),
  };
  nodes.push(trigger);
  if (view.steps.length > 0) {
    const from = { id: trigger.id, ran: true, removed: false };
    placeList(view.steps, width / 2, TRIGGER_HEIGHT + ROW_GAP, from, {
      listId: "root",
      stops: false,
    });
  }
  // A column is as wide as its widest box, which may sit inside it: start the drawing at 0.
  const left = Math.min(...nodes.map((node) => node.x));
  const shifted = nodes.map((node) => ({ ...node, x: node.x - left }));
  return {
    nodes: shifted,
    edges,
    width: Math.max(...shifted.map((node) => node.x + node.width)),
    height: Math.max(...shifted.map((node) => node.y + node.height)),
  };
}

/** A node as the lines into and out of it see it. */
type Placed = { id: string; ran: boolean; removed: boolean };
type EndOf = { listId: string; stops: boolean };

function ranStep(step: GraphStep): boolean {
  return step.run === "taken" || step.run === "failed";
}

/** A column's width: its widest box, or the row of paths under its branch. */
function listWidth(steps: GraphStep[]): number {
  const branch = steps.find((step) => step.branch !== null)?.branch;
  if (branch == null) return STEP_WIDTH;
  const row = branch.paths.reduce((sum, path) => sum + pathWidth(path), 0);
  return Math.max(STEP_WIDTH, row + COLUMN_GAP * (branch.paths.length - 1));
}

function pathWidth(path: GraphPath): number {
  return Math.max(PATH_WIDTH, STOPS_WIDTH, listWidth(path.steps));
}
