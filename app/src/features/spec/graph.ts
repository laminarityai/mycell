// The workflow graph's view model: the spec as a tree of view steps and view paths, each in
// plain words with its risk level and reviews, marked with a proposal's changes or a Try it's
// route. Pure, so client code may import it; `layout.ts` places it, and the page draws it.
// `spec` doesn't know the catalog (policy imports spec), so callers pass what it says about each
// action and which approvals the policy engine inserted, as `describeSpec` takes them.
import { describeCondition, describeStep, type ActionInfo } from "./describe";
import { changeMarks, type ChangeMarks } from "./graph-changes";
import type { BranchStep, Condition, Spec, Step, StepType } from "./types";

/** What the caller knows about one catalog action, and the app it acts in. */
export type GraphActionInfo<Risk extends string = string> = ActionInfo<Risk> & { app?: string };

export type GraphChange = "added" | "removed" | "changed";

/** How a Try it treated a step: it ran, it ran and failed, or the message never reached it. */
export type StepRun = "taken" | "failed" | "skipped";

export type PathStatus = "taken" | "not_taken" | "not_checked" | "not_needed";

/** One check of a path's condition as a Try it found it, with why it passed or failed. */
export type GraphTraceCheck = { check: string; passed: boolean; reason: string };

/**
 * What the graph reads from a Try it: each step it reached, in order, and for a branch each
 * path's status and checks. A dry run's result has this shape; `workflows` can't import
 * `runtime`, so the graph names the shape rather than the type.
 */
export type GraphTrace = {
  steps: readonly {
    stepId: string;
    /** `succeeded`, or why the step didn't. */
    status: string;
    paths?: readonly {
      id: string;
      status: PathStatus;
      checks: readonly GraphTraceCheck[];
    }[];
  }[];
};

export type GraphStep<Risk extends string = string> = {
  id: string;
  type: StepType;
  /** The kind of step, as a box's heading says it: "Classify", "Gmail · add label". */
  title: string;
  /** The app its action acts in, as the catalog names it; null for a step that uses none. */
  app: string | null;
  /** One plain line about what it does. */
  text: string;
  /** The risk level of the action it uses; null for a step that uses none. */
  risk: Risk | null;
  /** Where a person reviews: an approval the spec names, or one the policy engine inserted. */
  review: "spec" | "policy" | null;
  /** What a proposal does to it; null when it's unchanged or nothing is proposed. */
  change: GraphChange | null;
  /** For a changed step, what it did before. */
  before: string | null;
  /** How a Try it treated it; null when nothing was tried. */
  run: StepRun | null;
  /** A branch's mode and its paths, left to right in the order they're checked, otherwise last. */
  branch: { mode: BranchStep["mode"]; paths: GraphPath<Risk>[] } | null;
};

export type GraphPath<Risk extends string = string> = {
  id: string;
  /** The path's name; null for the otherwise path. */
  name: string | null;
  /** The condition in plain words; null for the otherwise path. */
  condition: string | null;
  change: GraphChange | null;
  /** For a changed path, its name and condition before. */
  before: string | null;
  /** Whether a Try it took the path, and each check's result; null when nothing was tried. */
  run: { status: PathStatus; checks: GraphTraceCheck[] } | null;
  steps: GraphStep<Risk>[];
};

export type GraphView<Risk extends string = string> = {
  /** The steps under the trigger. None before a workflow has any. */
  steps: GraphStep<Risk>[];
  /** A Try it's route is drawn. */
  tried: boolean;
};

/** A spec as one side of the graph: the policy engine's output, and what it inserted. */
export type GraphSide = { spec: Spec; insertedApprovals?: readonly string[] };

export type GraphOptions<Risk extends string = string> = {
  /** The catalog's entry for an action; undefined for one it doesn't have. */
  action?: (name: string) => GraphActionInfo<Risk> | undefined;
  /** The IDs of the approval steps the policy engine inserted into `spec`. */
  insertedApprovals?: readonly string[];
  /** A Try it of the spec, whose route the graph lights up. */
  trace?: GraphTrace;
  /** A proposed spec, drawn as its changes to `spec`. */
  proposal?: GraphSide;
};

/**
 * The spec as the graph draws it, or a proposal as its changes to it. A null spec is a
 * workflow with none yet: no steps, or a proposal all new.
 */
export function graphView<Risk extends string = string>(
  spec: Spec | null,
  options: GraphOptions<Risk> = {},
): GraphView<Risk> {
  const { proposal } = options;
  const drawn = proposal?.spec ?? spec;
  if (drawn === null) return { steps: [], tried: false };
  const marks = proposal === undefined ? null : changeMarks(spec, proposal.spec);
  const words = stepWords(
    options.action,
    new Set(proposal?.insertedApprovals ?? options.insertedApprovals),
  );
  const removedWords = stepWords(options.action, new Set(options.insertedApprovals));
  const route = routeOf(options.trace);

  // A step the proposal removes, and everything on its paths, struck through.
  const removedStep = (step: Step): GraphStep<Risk> => ({
    ...removedWords(step),
    change: "removed",
    before: null,
    run: null,
    branch:
      step.type === "branch"
        ? { mode: step.mode, paths: pathsOf(step).map((path) => removedPath(path)) }
        : null,
  });
  const removedPath = (path: AnyPath): GraphPath<Risk> => ({
    ...pathHeading(path),
    change: "removed",
    before: null,
    run: null,
    steps: path.steps.map(removedStep),
  });

  const list = (steps: Step[], listId: string): GraphStep<Risk>[] => {
    const drawnSteps = steps.map((step): GraphStep<Risk> => {
      const mark = marks?.step(step.id);
      return {
        ...words(step),
        change: mark?.change ?? null,
        before:
          mark?.change === "changed" && mark.before !== undefined ? words(mark.before).text : null,
        run: route.step(step.id),
        branch: step.type === "branch" ? { mode: step.mode, paths: paths(step) } : null,
      };
    });
    if (marks === null) return drawnSteps;
    return withRemoved(marks.baseList(listId), marks.stepGone, drawnSteps, removedStep);
  };
  const paths = (step: BranchStep): GraphPath<Risk>[] => {
    // An otherwise path is new with its branch, and otherwise has nothing of its own to change.
    const branchAdded = marks?.step(step.id).change === "added";
    const drawnPaths = pathsOf(step).map((path): GraphPath<Risk> => {
      const mark: ReturnType<ChangeMarks["path"]> | undefined =
        path.name !== null
          ? marks?.path(path.id)
          : { change: branchAdded ? "added" : null, before: null };
      return {
        ...pathHeading(path),
        change: mark?.change ?? null,
        before: mark?.before ?? null,
        run: route.path(path.id),
        steps: list(path.steps, path.id),
      };
    });
    if (marks === null) return drawnPaths;
    const otherwise = drawnPaths.splice(-1);
    const base = marks.basePaths(step.id);
    return [...withRemoved(base, marks.pathGone, drawnPaths, removedPath), ...otherwise];
  };
  return { steps: list(drawn.steps, "root"), tried: options.trace !== undefined };
}

/** A branch's path or its otherwise path, which has no name or condition. */
type AnyPath = { id: string; name: string | null; condition?: Condition; steps: Step[] };

/** A branch's paths left to right, its otherwise path last. */
function pathsOf(step: BranchStep): AnyPath[] {
  return [...step.paths, { ...step.otherwise, name: null }];
}

function pathHeading(path: AnyPath): Pick<GraphPath, "id" | "name" | "condition"> {
  return {
    id: path.id,
    name: path.name,
    condition: path.condition === undefined ? null : describeCondition(path.condition),
  };
}

/**
 * The drawn list with the base's removed items put back where they stood: before the first
 * kept item that followed them in the base, or at the end.
 */
function withRemoved<Base extends { id: string }, Drawn extends { id: string }>(
  base: readonly Base[],
  gone: (id: string) => boolean,
  drawn: Drawn[],
  drawRemoved: (item: Base) => Drawn,
): Drawn[] {
  const shown = new Set(drawn.map((item) => item.id));
  const before = new Map<string, Drawn[]>();
  let pending: Drawn[] = [];
  for (const item of base) {
    if (gone(item.id)) {
      pending.push(drawRemoved(item));
    } else if (shown.has(item.id) && pending.length > 0) {
      before.set(item.id, pending);
      pending = [];
    }
  }
  return [...drawn.flatMap((item) => [...(before.get(item.id) ?? []), item]), ...pending];
}

/** A Try it's route by step and path ID; every lookup is null when nothing was tried. */
function routeOf(trace: GraphTrace | undefined) {
  const steps = new Map(trace?.steps.map((step) => [step.stepId, step.status]));
  const paths = new Map(
    trace?.steps.flatMap((step) =>
      (step.paths ?? []).map((path) => [
        path.id,
        { status: path.status, checks: [...path.checks] },
      ]),
    ),
  );
  return {
    step: (id: string): StepRun | null => {
      if (trace === undefined) return null;
      const status = steps.get(id);
      return status === undefined ? "skipped" : status === "succeeded" ? "taken" : "failed";
    },
    path: (id: string): GraphPath["run"] => paths.get(id) ?? null,
  };
}

type StepWords<Risk extends string> = Pick<
  GraphStep<Risk>,
  "id" | "type" | "title" | "app" | "text" | "risk" | "review"
>;

const TITLES: Record<StepType, string> = {
  classify: "Classify",
  extract: "Extract",
  tool: "Action",
  draft: "Draft a reply",
  approval: "Waits for review",
  escalate: "Hand to a person",
  branch: "Branch",
};

function stepWords<Risk extends string>(
  action: GraphOptions<Risk>["action"],
  inserted: ReadonlySet<string>,
): (step: Step) => StepWords<Risk> {
  return (step) => {
    const name = step.type === "tool" ? step.action : step.type === "draft" ? step.output : null;
    const info = name === null ? undefined : action?.(name);
    return {
      id: step.id,
      type: step.type,
      title: titleOf(step, info),
      app: info?.app ?? null,
      text: step.type === "branch" ? branchLine(step) : describeStep(step, info?.description),
      risk: info?.risk ?? null,
      review: step.type !== "approval" ? null : inserted.has(step.id) ? "policy" : "spec",
    };
  };
}

function titleOf(step: Step, info: GraphActionInfo | undefined): string {
  if (step.type === "branch") {
    return `Branch · ${step.mode === "first" ? "first match" : "every match"}`;
  }
  if (step.type !== "tool") return TITLES[step.type];
  const verb = step.action.split(".").at(-1)?.replaceAll("-", " ") ?? step.action;
  return info?.app === undefined ? verb : `${info.app} · ${verb}`;
}

/** A branch's one line; each path's condition is written on the path. */
function branchLine(step: BranchStep): string {
  return step.mode === "first"
    ? "Runs the first path that applies, checked left to right."
    : "Runs every path that applies, one after another, left to right.";
}
