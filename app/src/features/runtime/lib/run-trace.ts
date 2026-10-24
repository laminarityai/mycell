// A run's records read against the version it ran: the trace the workflow graph lights up, as it
// lights a Try it, and how each step's checks went. Pure: from what the records hold (statuses,
// a branch's taken paths and each check's pass or fail, never a value) and the spec's own words.
import { z } from "zod";
import { describeCheck, type SubjectWords } from "@/features/spec/conditions";
import type { GraphTrace } from "@/features/spec/graph";
import { findStep } from "@/features/spec/tree";
import type { BranchStep, Spec, Step } from "@/features/spec/types";
import type { Json } from "@/lib/inngest";
import type { RunStepCheck, RunStepRecord } from "../types";

/** A step's record, as far as the trace reads it. */
type Recorded = Pick<RunStepRecord, "stepId" | "status" | "output">;

type TracedPath = NonNullable<GraphTrace["steps"][number]["paths"]>[number];

// What a branch records (`branchStep`), or, for a run of a v1 version, its gate's result.
const branchRecordSchema = z.union([
  z.object({
    taken: z.array(z.string()),
    paths: z
      .array(z.object({ id: z.string(), holds: z.boolean(), checks: z.array(z.boolean()) }))
      .default([]),
  }),
  z.object({ passed: z.boolean() }),
]);

/**
 * The steps the run reached, in order, and the paths each branch took. With `words` (the run is
 * shown in full) each checked path carries its checks, passed or failed; without, none.
 */
export function runTrace(
  spec: Spec | undefined,
  steps: readonly Recorded[],
  words: SubjectWords | null,
): GraphTrace {
  return {
    steps: steps.map((step) => {
      const branch = spec === undefined ? undefined : findStep(spec, step.stepId);
      const paths =
        branch?.type === "branch" && step.status === "succeeded"
          ? branchPaths(branch, step.output, words)
          : undefined;
      return paths === undefined
        ? { stepId: step.stepId, status: step.status }
        : { stepId: step.stepId, status: step.status, paths };
    }),
  };
}

function branchPaths(
  branch: BranchStep,
  output: Json,
  words: SubjectWords | null,
): TracedPath[] | undefined {
  const parsed = branchRecordSchema.safeParse(output);
  if (!parsed.success) return undefined;
  const record =
    "taken" in parsed.data
      ? parsed.data
      : {
          taken: [parsed.data.passed ? (branch.paths.at(0)?.id ?? "") : branch.otherwise.id],
          paths: [],
        };
  const checked = new Map(record.paths.map((path) => [path.id, path.checks]));
  const named = branch.paths.map((path): TracedPath => {
    const passed = checked.get(path.id);
    const taken = record.taken.includes(path.id);
    // A first match stops checking at the path it takes; a v1 gate's record names no checks.
    const status = taken
      ? "taken"
      : passed !== undefined || record.paths.length === 0
        ? "not_taken"
        : "not_checked";
    const checks =
      words === null || passed === undefined
        ? []
        : path.condition.checks.map((check, index) => {
            const held = passed.at(index) ?? false;
            return {
              check: describeCheck(check, words),
              passed: held,
              reason: held ? "passed" : "failed",
            };
          });
    return { id: path.id, status, checks };
  });
  const otherwise = branch.otherwise.id;
  return [
    ...named,
    {
      id: otherwise,
      status: record.taken.includes(otherwise) ? "taken" : "not_needed",
      checks: [],
    },
  ];
}

const CHECK_ORDER = ["schema", "minP", "requiredFields"] as const;

const CHECK_CODES: Record<RunStepCheck["check"], string> = {
  schema: "check_schema",
  minP: "check_min_p",
  requiredFields: "check_required_fields",
};

/**
 * How each of a step's checks went, in the order they run: all passed on a step that succeeded;
 * up to the one that failed on a step whose check failed, the rest not checked; none checked on
 * a step that broke first.
 */
export function stepChecks(
  step: Step | undefined,
  record: Pick<RunStepRecord, "status" | "errorCode" | "errorMessage">,
): RunStepCheck[] {
  const checks = step?.checks;
  if (checks === undefined) return [];
  const listed = CHECK_ORDER.filter((check) => checks[check] !== undefined);
  const failed = listed.find((check) => CHECK_CODES[check] === record.errorCode);
  let reached = record.status === "succeeded" || failed !== undefined;
  return listed.map((check): RunStepCheck => {
    if (!reached) return { check, status: "not_checked", reason: null };
    if (record.status === "check_failed" && check === failed) {
      reached = false;
      return { check, status: "failed", reason: record.errorMessage };
    }
    return { check, status: "passed", reason: null };
  });
}
