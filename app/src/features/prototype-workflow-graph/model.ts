// PROTOTYPE, never merge. The pure part every variant shares: the policy engine's inserted
// reviews, plain-language words for steps and conditions, edits to the in-memory spec, the
// proposal diff, Try it's walk, and the view tree each variant draws.
import { ACTIONS, FACTS, RISK_LABELS, findAction } from "./catalog";
import type {
  BranchStep,
  Check,
  Condition,
  Operator,
  Path,
  RiskLevel,
  SampleMessage,
  SpecV2,
  Step,
  StepType,
} from "./types";

export { RISK_LABELS };

// Words -----------------------------------------------------------------------------------------

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  classify: "Classify",
  extract: "Extract",
  tool: "Action",
  draft: "Draft a reply",
  approval: "Waits for review",
  escalate: "Hand to a person",
  branch: "Branch",
};

export const OPERATOR_LABELS: Record<Operator, string> = {
  is: "is",
  is_not: "is not",
  more_than: "more than",
  less_than: "less than",
  contains: "contains",
  filled: "is filled in",
  empty: "is empty",
};

export function stepTitle(step: Step): string {
  if (step.type === "tool") {
    const action = findAction(step.action);
    return action === undefined ? step.action : `${action.app} · ${action.label}`;
  }
  return STEP_TYPE_LABELS[step.type];
}

export function describeStep(step: Step): string {
  switch (step.type) {
    case "classify":
      return `Asks "${step.question}": ${listWords(step.labels, "or")}.`;
    case "extract":
      return `Reads ${listWords(
        step.fields.map((field) => field.name),
        "and",
      )} from the message.`;
    case "tool":
      return describeTool(step.action, step.input);
    case "draft":
      return `Drafts a reply: "${step.instructions}"`;
    case "approval":
      return "Waits for a person to send or delete the Gmail draft.";
    case "escalate":
      return `Hands the message to a person: ${step.reason}`;
    case "branch":
      return step.mode === "first"
        ? "Runs the first path that applies, checked left to right."
        : "Runs every path that applies, one after another, left to right.";
  }
}

function describeTool(action: string, input: Record<string, string>): string {
  switch (action) {
    case "google-mail.read-message":
      return "Reads the message's IDs and labels.";
    case "google-mail.read-thread":
      return "Reads the whole thread the message belongs to.";
    case "google-mail.add-label":
      return `Adds the label "${input.label ?? "?"}".`;
    case "google-sheet.read-range":
      return `Looks up ${input.range ?? "a range"} in "${input.spreadsheetId ?? "a sheet"}".`;
    case "google-sheet.append-row":
      return `Adds a row to ${input.range ?? "a range"} in "${input.spreadsheetId ?? "a sheet"}".`;
    case "google-tasks.create-task":
      return `Adds the task "${input.title ?? "?"}" to ${input.list ?? "a list"}.`;
    default:
      return findAction(action)?.description ?? `Runs ${action}.`;
  }
}

function listWords(words: string[], joiner: "and" | "or"): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} ${joiner} ${words.at(-1) ?? ""}`;
}

export function stepRisk(step: Step): RiskLevel | null {
  if (step.type === "tool") return findAction(step.action)?.risk ?? null;
  if (step.type === "draft") return "external_send";
  return null;
}

function formatValue(value: string): string {
  if (value === "") return "empty";
  const number = Number(value);
  if (value.trim() !== "" && Number.isFinite(number)) return number.toLocaleString("en-US");
  return value;
}

export function describeCheck(check: Check): string {
  switch (check.kind) {
    case "classify":
      return `is ${check.label}, ${String(Math.round(check.minP * 100))}%+ sure`;
    case "value":
      return comparison(check.field, check.op, check.value);
    case "fact":
      return comparison(FACTS[check.fact], check.op, check.value, check.fact === "subject");
    case "tool":
      return comparison(`${check.step}'s ${check.field}`, check.op, check.value);
  }
}

function comparison(subject: string, op: Operator, value: string, quote = false): string {
  if (op === "filled" || op === "empty") return `${subject} ${OPERATOR_LABELS[op]}`;
  const shown = quote ? `"${value}"` : formatValue(value);
  return `${subject} ${OPERATOR_LABELS[op]} ${shown}`;
}

export function describeCondition(condition: Condition): string {
  if (condition.checks.length === 0) return "always";
  return condition.checks.map(describeCheck).join(condition.combine === "all" ? " and " : " or ");
}

// Finding things --------------------------------------------------------------------------------

/** A step list: `root`, a path's ID, or an otherwise path's ID. */
export type ListId = string;

export function findList(spec: SpecV2, listId: ListId): Step[] | undefined {
  if (listId === "root") return spec.steps;
  let found: Step[] | undefined;
  eachBranch(spec.steps, (branch) => {
    for (const path of branch.paths) if (path.id === listId) found = path.steps;
    if (branch.otherwise.id === listId) found = branch.otherwise.steps;
  });
  return found;
}

function eachBranch(steps: Step[], visit: (branch: BranchStep) => void) {
  for (const step of steps) {
    if (step.type !== "branch") continue;
    visit(step);
    for (const path of step.paths) eachBranch(path.steps, visit);
    eachBranch(step.otherwise.steps, visit);
  }
}

function eachStep(steps: Step[], visit: (step: Step) => void) {
  for (const step of steps) {
    visit(step);
    if (step.type === "branch") {
      for (const path of step.paths) eachStep(path.steps, visit);
      eachStep(step.otherwise.steps, visit);
    }
  }
}

export function findStep(spec: SpecV2, id: string): Step | undefined {
  let found: Step | undefined;
  eachStep(spec.steps, (step) => {
    if (step.id === id) found = step;
  });
  return found;
}

export function findPath(
  spec: SpecV2,
  id: string,
): { path: Path; branch: BranchStep; index: number } | undefined {
  let found: { path: Path; branch: BranchStep; index: number } | undefined;
  eachBranch(spec.steps, (branch) => {
    branch.paths.forEach((path, index) => {
      if (path.id === id) found = { path, branch, index };
    });
  });
  return found;
}

/** The steps a path's condition may test: everything above its branch on its own route. */
export function stepsAbove(spec: SpecV2, targetId: string): Step[] {
  function walk(steps: Step[], above: Step[]): Step[] | undefined {
    const seen: Step[] = [...above];
    for (const step of steps) {
      if (step.id === targetId) return seen;
      if (step.type === "branch") {
        for (const path of step.paths) {
          if (path.id === targetId) return seen;
          const inner = walk(path.steps, seen);
          if (inner !== undefined) return inner;
        }
        if (step.otherwise.id === targetId) return seen;
        const inner = walk(step.otherwise.steps, seen);
        if (inner !== undefined) return inner;
      }
      seen.push(step);
    }
    return undefined;
  }
  return walk(spec.steps, []) ?? [];
}

/** The fields a condition may test, as declared by the steps above it and the trigger. */
export type TestableField =
  | { kind: "classify"; step: string; labels: string[] }
  | { kind: "value"; step: string; field: string; type: string }
  | { kind: "tool"; step: string; field: string; type: string };

export function testableFields(spec: SpecV2, pathId: string): TestableField[] {
  return stepsAbove(spec, pathId).flatMap((step): TestableField[] => {
    if (step.type === "classify") return [{ kind: "classify", step: step.id, labels: step.labels }];
    if (step.type === "extract") {
      return step.fields.map((field) => ({
        kind: "value",
        step: step.id,
        field: field.name,
        type: field.type,
      }));
    }
    if (step.type === "tool") {
      return (findAction(step.action)?.returns ?? []).map((field) => ({
        kind: "tool",
        step: step.id,
        field: field.name,
        type: field.type,
      }));
    }
    return [];
  });
}

// Edits -----------------------------------------------------------------------------------------

function edit(spec: SpecV2, change: (draft: SpecV2) => void): SpecV2 {
  const draft = structuredClone(spec);
  change(draft);
  return draft;
}

function allIds(spec: SpecV2): Set<string> {
  const ids = new Set<string>();
  eachStep(spec.steps, (step) => {
    ids.add(step.id);
    if (step.type === "branch") {
      for (const path of step.paths) ids.add(path.id);
      ids.add(step.otherwise.id);
    }
  });
  return ids;
}

function freshId(spec: SpecV2, base: string): string {
  const ids = allIds(spec);
  if (!ids.has(base)) return base;
  for (let n = 2; ; n++) if (!ids.has(`${base}-${String(n)}`)) return `${base}-${String(n)}`;
}

export type NewStepKind =
  "classify" | "extract" | "draft" | "escalate" | "branch" | `tool:${string}`;

export const NEW_STEP_MENU: { kind: NewStepKind; label: string; hint: string }[] = [
  { kind: "classify", label: "Classify", hint: "Sort the message into labels" },
  { kind: "extract", label: "Extract", hint: "Read values out of the message" },
  { kind: "draft", label: "Draft a reply", hint: "Waits for review (policy)" },
  { kind: "escalate", label: "Hand to a person", hint: "Stop and pass it on" },
  ...ACTIONS.filter((action) => action.name !== "google-mail.create-draft").map((action) => ({
    kind: `tool:${action.name}` as const,
    label: `${action.app} · ${action.label}`,
    hint: RISK_LABELS[action.risk],
  })),
  { kind: "branch", label: "Branch", hint: "Split into paths" },
];

export function insertStep(
  spec: SpecV2,
  listId: ListId,
  index: number,
  kind: NewStepKind,
): { spec: SpecV2; id: string } {
  let id = "";
  const next = edit(spec, (draft) => {
    const list = findList(draft, listId);
    if (list === undefined) return;
    const step = newStep(draft, kind);
    id = step.id;
    if (step.type === "branch") {
      // A branch ends its list: the steps below it move into its otherwise path.
      step.otherwise.steps = list.splice(index);
    }
    list.splice(index, 0, step);
  });
  return { spec: next, id };
}

function newStep(spec: SpecV2, kind: NewStepKind): Step {
  if (kind.startsWith("tool:")) {
    const action = findAction(kind.slice("tool:".length));
    const input: Record<string, string> = {};
    for (const name of action?.inputs ?? []) input[name] = "";
    return {
      id: freshId(spec, action?.label.toLowerCase().replace(/[^a-z]+/g, "-") ?? "action"),
      type: "tool",
      action: action?.name ?? "google-mail.add-label",
      input,
    };
  }
  switch (kind) {
    case "classify":
      return {
        id: freshId(spec, "classify"),
        type: "classify",
        role: "classify",
        question: "What is this email about?",
        labels: ["yes", "no"],
      };
    case "extract":
      return {
        id: freshId(spec, "extract"),
        type: "extract",
        role: "fast",
        fields: [{ name: "value", type: "string", description: "What to read from the message." }],
      };
    case "draft":
      return {
        id: freshId(spec, "draft"),
        type: "draft",
        role: "smart",
        instructions: "Reply politely and briefly.",
        context: ["trigger.message"],
        output: "google-mail.create-draft",
      };
    case "escalate":
      return {
        id: freshId(spec, "hand-off"),
        type: "escalate",
        reason: "Someone should look at this.",
      };
    default: {
      const id = freshId(spec, "branch");
      const pathId = freshId(spec, `${id}-path`);
      return {
        id,
        type: "branch",
        mode: "first",
        paths: [
          { id: pathId, name: "New path", condition: { combine: "all", checks: [] }, steps: [] },
        ],
        otherwise: { id: `${id}-otherwise`, steps: [] },
      };
    }
  }
}

export function updateStep(spec: SpecV2, id: string, change: (step: Step) => void): SpecV2 {
  return edit(spec, (draft) => {
    const step = findStep(draft, id);
    if (step !== undefined) change(step);
  });
}

export function removeStep(spec: SpecV2, id: string): SpecV2 {
  return edit(spec, (draft) => {
    const remove = (steps: Step[]) => {
      const index = steps.findIndex((step) => step.id === id);
      if (index >= 0) steps.splice(index, 1);
      for (const step of steps) {
        if (step.type !== "branch") continue;
        for (const path of step.paths) remove(path.steps);
        remove(step.otherwise.steps);
      }
    };
    remove(draft.steps);
  });
}

export function updatePath(spec: SpecV2, id: string, change: (path: Path) => void): SpecV2 {
  return edit(spec, (draft) => {
    const found = findPath(draft, id);
    if (found !== undefined) change(found.path);
  });
}

export function movePath(spec: SpecV2, id: string, by: -1 | 1): SpecV2 {
  return edit(spec, (draft) => {
    const found = findPath(draft, id);
    if (found === undefined) return;
    const { branch, index } = found;
    const to = index + by;
    if (to < 0 || to >= branch.paths.length) return;
    const [path] = branch.paths.splice(index, 1);
    branch.paths.splice(to, 0, path);
  });
}

export function addPath(spec: SpecV2, branchId: string): { spec: SpecV2; id: string } {
  let id = "";
  const next = edit(spec, (draft) => {
    const branch = findStep(draft, branchId);
    if (branch?.type !== "branch") return;
    id = freshId(draft, `${branchId}-path`);
    branch.paths.push({
      id,
      name: "New path",
      condition: { combine: "all", checks: [] },
      steps: [],
    });
  });
  return { spec: next, id };
}

export function removePath(spec: SpecV2, id: string): SpecV2 {
  return edit(spec, (draft) => {
    const found = findPath(draft, id);
    if (found === undefined) return;
    found.branch.paths.splice(found.index, 1);
  });
}

// Try it ----------------------------------------------------------------------------------------

export type CheckResult = { text: string; passed: boolean; why: string };

export type PathRun =
  | { status: "taken"; checks: CheckResult[] }
  | { status: "failed"; checks: CheckResult[] }
  | { status: "not-checked" }
  | { status: "not-reached" };

export type TryResult = {
  steps: Map<string, "taken" | "skipped">;
  paths: Map<string, PathRun>;
};

export function tryIt(spec: SpecV2, sample: SampleMessage): TryResult {
  const result: TryResult = { steps: new Map(), paths: new Map() };
  const walk = (steps: Step[], reached: boolean) => {
    for (const step of steps) {
      result.steps.set(step.id, reached ? "taken" : "skipped");
      if (step.type === "branch") {
        let matched = false;
        for (const path of step.paths) {
          if (!reached) {
            result.paths.set(path.id, { status: "not-reached" });
            walk(path.steps, false);
            continue;
          }
          if (step.mode === "first" && matched) {
            result.paths.set(path.id, { status: "not-checked" });
            walk(path.steps, false);
            continue;
          }
          const checks = path.condition.checks.map((check) => evaluate(check, sample));
          const passed =
            checks.length === 0 ||
            (path.condition.combine === "all"
              ? checks.every((check) => check.passed)
              : checks.some((check) => check.passed));
          result.paths.set(path.id, { status: passed ? "taken" : "failed", checks });
          walk(path.steps, passed);
          matched ||= passed;
        }
        const otherwise = reached && !matched;
        result.paths.set(
          step.otherwise.id,
          reached
            ? { status: otherwise ? "taken" : "not-checked", checks: [] }
            : { status: "not-reached" },
        );
        walk(step.otherwise.steps, otherwise);
      }
    }
  };
  walk(spec.steps, true);
  return result;
}

function evaluate(check: Check, sample: SampleMessage): CheckResult {
  const text = describeCheck(check);
  if (check.kind === "classify") {
    const answer = sample.classify[check.step] ?? { label: "other", p: 0.5 };
    const pct = Math.round(answer.p * 100);
    const need = Math.round(check.minP * 100);
    if (answer.label !== check.label) {
      return { text, passed: false, why: `said "${answer.label}", not "${check.label}"` };
    }
    if (answer.p < check.minP) {
      return {
        text,
        passed: false,
        why: `said "${answer.label}" but only ${String(pct)}% sure (needs ${String(need)}%)`,
      };
    }
    return { text, passed: true, why: `said "${answer.label}", ${String(pct)}% sure` };
  }
  const value =
    check.kind === "fact"
      ? (sample.facts[check.fact] ?? "")
      : check.kind === "value"
        ? (sample.extract[check.step]?.[check.field] ?? "")
        : (sample.tool[check.step]?.[check.field] ?? "");
  const passed = compare(check.op, value, check.value);
  const subject = check.kind === "fact" ? FACTS[check.fact] : check.field;
  const shown =
    check.kind === "fact" && check.fact === "subject" ? `"${value}"` : formatValue(value);
  return { text, passed, why: `${subject} was ${shown}` };
}

function compare(op: Operator, value: string, target: string): boolean {
  const a = value.trim().toLowerCase();
  const b = target.trim().toLowerCase();
  switch (op) {
    case "is":
      return a === b;
    case "is_not":
      return a !== b;
    case "more_than":
      return Number(a) > Number(b);
    case "less_than":
      return Number(a) < Number(b);
    case "contains":
      return a.includes(b);
    case "filled":
      return a !== "";
    case "empty":
      return a === "";
  }
}

// The view tree ---------------------------------------------------------------------------------

export type Change = "added" | "removed" | "changed" | null;

export type ViewStep = {
  id: string;
  step: Step;
  type: StepType;
  title: string;
  text: string;
  risk: RiskLevel | null;
  /** The policy engine inserted it: it can't be removed or edited. */
  byPolicy: boolean;
  change: Change;
  /** The words before a proposal changed it. */
  before: string | null;
  run: "taken" | "skipped" | null;
  /** Where "+" below this step inserts, or null where nothing may go (after a branch). */
  insertAfter: { listId: ListId; index: number } | null;
  branch: { mode: "first" | "every"; paths: ViewPath[] } | null;
};

export type ViewPath = {
  id: string;
  name: string;
  otherwise: boolean;
  condition: string;
  /** The condition before a proposal changed it. */
  before: string | null;
  change: Change;
  run: PathRun | null;
  steps: ViewStep[];
  /** Where "+" at the top of the path inserts. */
  listId: ListId;
  /** Its place among the branch's paths, for move left / right; null for otherwise. */
  order: { index: number; count: number } | null;
};

export type ViewTree = {
  steps: ViewStep[];
  /** True when there is nothing yet: only the trigger shows. */
  empty: boolean;
};

export function buildView(
  current: SpecV2 | null,
  options: { proposal?: SpecV2 | null; tryIt?: TryResult | null } = {},
): ViewTree {
  const proposal = options.proposal ?? null;
  if (proposal !== null) {
    return {
      steps: mergeList(current?.steps ?? [], proposal.steps, "root", current === null),
      empty: false,
    };
  }
  if (current === null) return { steps: [], empty: true };
  return { steps: plainList(current.steps, "root", options.tryIt ?? null), empty: false };
}

function baseView(
  step: Step,
  change: Change,
  before: string | null,
): Omit<ViewStep, "insertAfter" | "branch" | "run"> {
  return {
    id: step.id,
    step,
    type: step.type,
    title: stepTitle(step),
    text: describeStep(step),
    risk: stepRisk(step),
    byPolicy: false,
    change,
    before,
  };
}

function reviewFor(draft: ViewStep): ViewStep {
  const step: Step = { id: `${draft.id}-review`, type: "approval", channel: "gmail_drafts" };
  return {
    ...baseView(step, draft.change === "changed" ? null : draft.change, null),
    byPolicy: true,
    run: draft.run,
    insertAfter: draft.insertAfter,
    branch: null,
  };
}

function plainList(steps: Step[], listId: ListId, run: TryResult | null): ViewStep[] {
  return steps.flatMap((step, index): ViewStep[] => {
    const view: ViewStep = {
      ...baseView(step, null, null),
      run: run?.steps.get(step.id) ?? null,
      insertAfter: step.type === "branch" ? null : { listId, index: index + 1 },
      branch:
        step.type === "branch"
          ? {
              mode: step.mode,
              paths: [
                ...step.paths.map((path, i) =>
                  plainPath(path, { index: i, count: step.paths.length }, run),
                ),
                {
                  id: step.otherwise.id,
                  name: "Otherwise",
                  otherwise: true,
                  condition: "no other path applies",
                  before: null,
                  change: null,
                  run: run?.paths.get(step.otherwise.id) ?? null,
                  steps: plainList(step.otherwise.steps, step.otherwise.id, run),
                  listId: step.otherwise.id,
                  order: null,
                },
              ],
            }
          : null,
    };
    return step.type === "draft" ? [view, reviewFor(view)] : [view];
  });
}

function plainPath(
  path: Path,
  order: { index: number; count: number },
  run: TryResult | null,
): ViewPath {
  return {
    id: path.id,
    name: path.name,
    otherwise: false,
    condition: describeCondition(path.condition),
    before: null,
    change: null,
    run: run?.paths.get(path.id) ?? null,
    steps: plainList(path.steps, path.id, run),
    listId: path.id,
    order,
  };
}

/** The proposal drawn as changes: its steps, plus the current ones it removes, struck through. */
function mergeList(before: Step[], after: Step[], listId: ListId, allNew: boolean): ViewStep[] {
  const afterIds = new Set(after.map((step) => step.id));
  const out: ViewStep[] = [];
  let b = 0;
  const removed = (step: Step) => {
    out.push(...markAll(plainList([step], listId, null), "removed"));
  };
  for (const step of after) {
    const match = before.findIndex((old) => old.id === step.id);
    if (match >= 0) {
      for (; b < match; b++) if (!afterIds.has(before[b].id)) removed(before[b]);
      b = match + 1;
    }
    const old = match >= 0 ? before[match] : undefined;
    const change: Change =
      allNew || old === undefined ? "added" : sameStep(old, step) ? null : "changed";
    const view: ViewStep = {
      ...baseView(
        step,
        change,
        change === "changed" && old !== undefined ? describeStep(old) : null,
      ),
      run: null,
      insertAfter: null,
      branch:
        step.type === "branch"
          ? {
              mode: step.mode,
              paths: mergePaths(
                old?.type === "branch" ? old : null,
                step,
                allNew || old === undefined,
              ),
            }
          : null,
    };
    out.push(view);
    if (step.type === "draft") out.push(reviewFor(view));
  }
  for (; b < before.length; b++) if (!afterIds.has(before[b].id)) removed(before[b]);
  return out;
}

function mergePaths(before: BranchStep | null, after: BranchStep, allNew: boolean): ViewPath[] {
  const out: ViewPath[] = after.paths.map((path, index) => {
    const old = before?.paths.find((candidate) => candidate.id === path.id);
    const condition = describeCondition(path.condition);
    const oldCondition = old === undefined ? null : describeCondition(old.condition);
    const change: Change =
      allNew || old === undefined
        ? "added"
        : oldCondition !== condition || old.name !== path.name
          ? "changed"
          : null;
    return {
      id: path.id,
      name: path.name,
      otherwise: false,
      condition,
      before: change === "changed" ? oldCondition : null,
      change,
      run: null,
      steps: mergeList(old?.steps ?? [], path.steps, path.id, allNew || old === undefined),
      listId: path.id,
      order: { index, count: after.paths.length },
    };
  });
  for (const old of before?.paths ?? []) {
    if (after.paths.some((path) => path.id === old.id)) continue;
    out.push({
      ...plainPath(old, { index: 0, count: 1 }, null),
      change: "removed",
      order: null,
      steps: markAll(plainList(old.steps, old.id, null), "removed"),
    });
  }
  out.push({
    id: after.otherwise.id,
    name: "Otherwise",
    otherwise: true,
    condition: "no other path applies",
    before: null,
    change: allNew ? "added" : null,
    run: null,
    steps: mergeList(
      before?.otherwise.steps ?? [],
      after.otherwise.steps,
      after.otherwise.id,
      allNew,
    ),
    listId: after.otherwise.id,
    order: null,
  });
  return out;
}

function markAll(steps: ViewStep[], change: Change): ViewStep[] {
  return steps.map((step) => ({
    ...step,
    change,
    branch:
      step.branch === null
        ? null
        : {
            ...step.branch,
            paths: step.branch.paths.map((path) => ({
              ...path,
              change,
              steps: markAll(path.steps, change),
            })),
          },
  }));
}

/** Two steps are the same when everything but a branch's paths matches. */
function sameStep(a: Step, b: Step): boolean {
  if (a.type === "branch" && b.type === "branch") return a.mode === b.mode;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The proposal card's flat list: every step in the proposal, in reading order. */
export function flattenView(steps: ViewStep[]): (ViewStep & { pathName: string | null })[] {
  const out: (ViewStep & { pathName: string | null })[] = [];
  const walk = (list: ViewStep[], pathName: string | null) => {
    for (const step of list) {
      out.push({ ...step, pathName });
      for (const path of step.branch?.paths ?? []) walk(path.steps, path.name);
    }
  };
  walk(steps, null);
  return out;
}

/** The paths a proposal changed (their conditions), for the card. */
export function flattenPaths(steps: ViewStep[]): ViewPath[] {
  const out: ViewPath[] = [];
  const walk = (list: ViewStep[]) => {
    for (const step of list) {
      for (const path of step.branch?.paths ?? []) {
        out.push(path);
        walk(path.steps);
      }
    }
  };
  walk(steps);
  return out;
}
