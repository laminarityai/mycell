// The rules a branch and its paths must keep (ADR-0015), beyond their shape: path IDs unique
// with the steps', and each check on something above the branch on its own path, with an
// operator that fits it. Pure, so client code may import it.
import { valueCheckIssues, type DeclaredFields } from "./conditions";
import type { BranchStep, Check, SpecIssue, Step } from "./types";

type At = (...path: (string | number)[]) => SpecIssue["path"];

/** Finds a step above the one being checked, or records the issue at `path` and gives none. */
export type RefersBack = (stepId: string, path: SpecIssue["path"]) => Step | undefined;

/** The issues with `branch`, which `above` leads to and `at` places. */
export function branchIssues(
  branch: BranchStep,
  at: At,
  above: readonly Step[],
  refersBack: RefersBack,
  seen: Set<string>,
  declared: DeclaredFields,
): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const pathIds: [string, SpecIssue["path"]][] = [
    ...branch.paths.map((path, p): [string, SpecIssue["path"]] => [path.id, at("paths", p, "id")]),
    [branch.otherwise.id, at("otherwise", "id")],
  ];
  for (const [id, path] of pathIds) {
    if (seen.has(id)) issues.push({ path, message: `The ID "${id}" is used twice.` });
    seen.add(id);
  }
  if (branch.mode === "every") {
    issues.push({ path: at("mode"), message: "Every match isn't available yet; use first." });
  }
  branch.paths.forEach((path, p) => {
    path.condition.checks.forEach((check, c) => {
      const checkAt: At = (...field) => at("paths", p, "condition", "checks", c, ...field);
      issues.push(...checkIssues(check, checkAt, above, refersBack, declared));
    });
  });
  return issues;
}

/** A classify check names a classify step above and one of its labels; a value check fits. */
function checkIssues(
  check: Check,
  checkAt: At,
  above: readonly Step[],
  refersBack: RefersBack,
  declared: DeclaredFields,
) {
  if ("classify" in check) {
    const target = refersBack(check.classify, checkAt("classify"));
    if (target !== undefined && target.type !== "classify") {
      const message = `A classify check needs a classify step, and "${target.id}" is a ${target.type} step.`;
      return [{ path: checkAt("classify"), message }];
    }
    if (target?.type === "classify" && !target.labels.includes(check.is)) {
      return [{ path: checkAt("is"), message: `"${target.id}" has no label "${check.is}".` }];
    }
    return [];
  }
  return valueCheckIssues(check, checkAt, above, declared);
}
