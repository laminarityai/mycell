// The policy engine (invariant 4): a spec's risk comes only from the fixed levels of the actions
// in the company's action set, which the caller resolves and hands in (ADR-0018).
// Pure: no IO, no ctx.
import { z } from "zod";
import { eachStep, mapStepLists, type PlacedStep } from "@/features/spec/tree";
import type { ApprovalChannel, Spec, SpecIssue, Step } from "@/features/spec/types";
import { SpecInvalidError } from "@/lib/errors";
import { GOOGLE_SCOPE_PREFIX } from "@/lib/google";
import { appsUsed, scopesOf } from "./action-set";
import { conditionIssues } from "./condition-fields";
import {
  riskLevelSchema,
  type ActionSet,
  type Action,
  type InsertedApproval,
  type PolicyResult,
  type Requirements,
  type RequirementsGained,
  type RiskLevel,
} from "./types";

const ORDER = riskLevelSchema.options;

/**
 * The highest risk level among the spec's `tool` actions and `draft` outputs. Model steps
 * count as `read`. Any `risk` field in the spec is ignored. Throws SpecInvalidError on actions
 * `actions` doesn't have; `applyPolicy` reports those as issues instead.
 */
export function maxRisk(spec: Spec, actions: ActionSet): RiskLevel {
  let highest: RiskLevel = "read";
  for (const { step, location } of eachStep(spec)) {
    const used = actionOf(step);
    if (used === undefined) continue;
    const action = actions.find(used.name);
    if (action === undefined) {
      const path = [...location, used.field];
      throw new SpecInvalidError([
        {
          path,
          message: `"${used.name}" isn't a catalog action or one of the company's custom actions.`,
        },
      ]);
    }
    if (ORDER.indexOf(action.risk) > ORDER.indexOf(highest)) highest = action.risk;
  }
  return highest;
}

/**
 * Checks the spec's actions against `actions` and makes sure every `external_send` action
 * waits for a person: a `draft` output needs a `gmail_drafts` approval on its own path, and a
 * `tool` step's custom write a `held_send` one (ADR-0020); one is inserted directly after the
 * step when there's none. Returns the spec with what it inserted, or every issue at once.
 */
export function applyPolicy(spec: Spec, actions: ActionSet): PolicyResult {
  const issues = [...actionIssues(spec, actions), ...conditionIssues(spec, actions)];
  if (issues.length > 0) return { ok: false, issues };

  const inserted: InsertedApproval[] = [];
  const placed = eachStep(spec);
  const ids = new Set(placed.map(({ step }) => step.id));
  const unreviewed = new Map(unreviewedSends(placed, actions).map((send) => [send.stepId, send]));
  const withApprovals = mapStepLists(spec, (steps) =>
    steps.flatMap((step): Step[] => {
      const send = unreviewed.get(step.id);
      if (send === undefined) return [step];
      const stepId = freeId(`${step.id}-approval`, ids);
      ids.add(stepId);
      inserted.push({ stepId, after: step.id, action: send.action });
      return [step, { id: stepId, type: "approval", channel: send.channel }];
    }),
  );

  const result = inserted.length === 0 ? spec : withApprovals;
  return { ok: true, spec: result, maxRisk: maxRisk(result, actions), inserted };
}

/**
 * What `after` needs that `before` didn't, or null when nothing: a higher max risk level, an app
 * `before` didn't use, or a scope no action of `before` was allowed by less. An action allowed
 * by any one of several scopes needs nothing new when an action of `before` was allowed only by
 * some of them; otherwise it's its first scope, by short name. Decided from `actions` alone.
 */
export function requirementsGained(
  before: Requirements,
  after: Requirements,
  actions: ActionSet,
): RequirementsGained | null {
  const gained: RequirementsGained = {};
  if (ORDER.indexOf(after.maxRisk) > ORDER.indexOf(before.maxRisk)) {
    gained.maxRiskRaised = { from: before.maxRisk, to: after.maxRisk };
  }
  const apps = appsUsed(before.requiredActions, actions);
  const newApps = appsUsed(after.requiredActions, actions).filter((app) => !apps.includes(app));
  if (newApps.length > 0) gained.newApps = newApps;
  const needed = scopeSets(before.requiredActions, actions);
  const newScopes = scopeSets(after.requiredActions, actions)
    .filter((anyOf) => !needed.some((old) => old.every((scope) => anyOf.includes(scope))))
    .flatMap((anyOf) => anyOf.slice(0, 1).map(shortScope));
  if (newScopes.length > 0) gained.newScopes = [...new Set(newScopes)];
  return Object.keys(gained).length === 0 ? null : gained;
}

// Each action's scopes, any one of which allows it. A custom action needs no scope on the run's
// own connection: it reaches its app through a connection to that app, a new app. An action on
// what Mycel holds (memory) needs none either.
function scopeSets(actionNames: readonly string[], actions: ActionSet): (readonly string[])[] {
  return actionNames.flatMap((name) => {
    const action = actions.find(name);
    return action === undefined ? [] : scopesOf(action);
  });
}

function shortScope(scope: string): string {
  return scope.startsWith(GOOGLE_SCOPE_PREFIX) ? scope.slice(GOOGLE_SCOPE_PREFIX.length) : scope;
}

/**
 * What a step sends that waits for a person, and the approval channel that reviews it: a draft
 * step's Gmail draft, or a tool step's custom write, which Mycel holds (ADR-0020).
 */
function sendOf(
  step: Step,
  actions: ActionSet,
): { action: string; channel: ApprovalChannel } | undefined {
  if (step.type === "draft") return { action: step.output, channel: "gmail_drafts" };
  if (step.type !== "tool") return undefined;
  const action = actions.find(step.action);
  if (action?.kind !== "custom" || action.risk !== "external_send") return undefined;
  return { action: step.action, channel: "held_send" };
}

/**
 * The sends no approval reviews. Only an approval of the send's channel after it in its own list
 * reviews it: every run that makes the send reaches it. One above the send ran before the send
 * was made; one on a sibling path, or on a path below the send, which a run may not take,
 * doesn't count either: a branch chooses a path but never removes a review (ADR-0015).
 */
function unreviewedSends(
  placed: PlacedStep[],
  actions: ActionSet,
): { stepId: string; action: string; channel: ApprovalChannel }[] {
  // Each step's list, as the location of the list, and its index in it.
  const listOf = (location: SpecIssue["path"]) => JSON.stringify(location.slice(0, -1));
  const indexOf = (location: SpecIssue["path"]) => Number(location.at(-1));
  return placed.flatMap(({ step, location }) => {
    const send = sendOf(step, actions);
    if (send === undefined) return [];
    const reviewed = placed.some(
      (other) =>
        other.step.type === "approval" &&
        other.step.channel === send.channel &&
        listOf(other.location) === listOf(location) &&
        indexOf(other.location) > indexOf(location),
    );
    return reviewed ? [] : [{ stepId: step.id, ...send }];
  });
}

/**
 * Unknown actions, actions used where their risk level doesn't allow, and literal inputs the
 * action's input schema refuses.
 */
function actionIssues(spec: Spec, actions: ActionSet): SpecIssue[] {
  const issues: SpecIssue[] = [];
  for (const { step, location } of eachStep(spec)) {
    if (step.type !== "tool" && step.type !== "draft") continue;
    const [field, name] = step.type === "tool" ? ["action", step.action] : ["output", step.output];
    const path = [...location, field];
    const action = actions.find(name);
    if (action === undefined) {
      issues.push({
        path,
        message: `"${name}" isn't a catalog action or one of the company's custom actions.`,
      });
    } else if (
      step.type === "tool" &&
      action.kind === "catalog" &&
      action.risk === "external_send"
    ) {
      issues.push({
        path,
        message: `"${name}" sends outside the company, so it can only be a draft step's output.`,
      });
    } else if (step.type === "draft" && action.pendingForm === undefined) {
      issues.push({ path, message: `"${name}" doesn't create a draft; use it in a tool step.` });
    } else if (step.type === "tool") {
      issues.push(...literalInputIssues(step, location, action));
    }
  }
  return issues;
}

/**
 * Each literal input value the action's schema refuses for its field. A reference is resolved
 * only in a run, so the run checks it then; so do fields the action doesn't name.
 */
function literalInputIssues(
  step: Extract<Step, { type: "tool" }>,
  location: SpecIssue["path"],
  action: Action,
): SpecIssue[] {
  if (!(action.input instanceof z.ZodObject)) return [];
  const shape = action.input.shape as Record<string, z.ZodType | undefined>;
  return Object.entries(step.input).flatMap(([name, value]) => {
    const field = shape[name];
    if (field === undefined || (typeof value === "object" && value !== null)) return [];
    const parsed = field.safeParse(value);
    if (parsed.success) return [];
    const reason = parsed.error.issues.at(0)?.message ?? "It isn't valid.";
    return [{ path: [...location, "input", name], message: `${name}: ${reason}` }];
  });
}

function freeId(wanted: string, taken: Set<string>): string {
  let id = wanted;
  for (let n = 2; taken.has(id); n++) id = `${wanted}-${String(n)}`;
  return id;
}

// The catalog action a step uses, and the field that names it.
function actionOf(step: Step): { name: string; field: "action" | "output" } | undefined {
  if (step.type === "tool") return { name: step.action, field: "action" };
  if (step.type === "draft") return { name: step.output, field: "output" };
  return undefined;
}
