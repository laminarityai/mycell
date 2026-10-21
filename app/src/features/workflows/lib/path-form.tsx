"use client";

// The side panel's form for a path: its name, its place in the order paths are checked, and its
// condition, all of or any of its checks. Each check offers only what's above its branch on
// its own path. The otherwise path has no condition, so its panel only says what it does.
import { Button } from "@/components/ui/button";
import { checkChoices } from "@/features/policy/condition-fields";
import { movePath, removePath, updatePath } from "@/features/spec/edit";
import { eachStep } from "@/features/spec/tree";
import type { BranchStep, Check, Path, Spec } from "@/features/spec/types";
import { MoveButtons } from "./branch-fields";
import { CheckEditor, firstCheck } from "./check-editor";
import { PanelShell, type PanelProps } from "./panel-shell";
import { SelectField, TextField } from "./spec-fields";

/** The branch a path is on, and the path with its place; a null path is the otherwise path. */
export function pathPlace(
  spec: Spec,
  pathId: string,
): { branch: BranchStep; path: Path | null; index: number } | undefined {
  for (const { step } of eachStep(spec)) {
    if (step.type !== "branch") continue;
    const index = step.paths.findIndex((path) => path.id === pathId);
    const path = step.paths.find((candidate) => candidate.id === pathId);
    if (path !== undefined) return { branch: step, path, index };
    if (step.otherwise.id === pathId) return { branch: step, path: null, index: step.paths.length };
  }
  return undefined;
}

const COMBINE = [
  { value: "all", label: "all of these hold" },
  { value: "any", label: "any of these holds" },
];

export function PathForm({
  branch,
  path,
  index,
  spec,
  edit,
  issues,
  onClose,
}: PanelProps & { branch: BranchStep; path: Path; index: number }) {
  const choices = checkChoices(spec, branch.id);
  const update = (change: (path: Path) => Path) => {
    edit((current) => updatePath(current, path.id, change));
  };
  const setChecks = (checks: Check[]) => {
    update((current) => ({ ...current, condition: { ...current.condition, checks } }));
  };
  const { checks } = path.condition;
  const mode = branch.mode === "first" ? "First match" : "Every match";
  return (
    <PanelShell
      title={`Path: ${path.name}`}
      subtitle={`${mode} · path ${String(index + 1)} of ${String(branch.paths.length)}`}
      issues={issues.get(path.id)}
      onClose={onClose}
      onRemove={
        branch.paths.length === 1
          ? "A branch keeps at least one path besides otherwise; remove the branch instead."
          : () => {
              edit((current) => removePath(current, path.id));
              onClose();
            }
      }
      removeLabel="Remove path"
    >
      <TextField
        label="Name"
        value={path.name}
        onChange={(name) => {
          update((current) => ({ ...current, name }));
        }}
      />
      <div className="flex items-center justify-between text-sm font-medium">
        <span>Order</span>
        <MoveButtons
          name={path.name}
          index={index}
          count={branch.paths.length}
          onMove={(by) => {
            edit((current) => movePath(current, path.id, by));
          }}
        />
      </div>
      <SelectField
        label="Runs when"
        value={path.condition.combine}
        options={COMBINE}
        onChange={(combine) => {
          update((current) => ({
            ...current,
            condition: { ...current.condition, combine: combine === "any" ? "any" : "all" },
          }));
        }}
      />
      {checks.map((check, at) => (
        <CheckEditor
          key={at}
          check={check}
          choices={choices}
          onChange={(next) => {
            setChecks(checks.map((candidate, i) => (i === at ? next : candidate)));
          }}
          onRemove={
            checks.length === 1
              ? undefined
              : () => {
                  setChecks(checks.filter((_, i) => i !== at));
                }
          }
        />
      ))}
      <Button
        type="button"
        size="xs"
        variant="outline"
        className="self-start"
        onClick={() => {
          setChecks([...checks, firstCheck(choices)]);
        }}
      >
        Add a check
      </Button>
    </PanelShell>
  );
}

export function OtherwiseForm({ branch, onClose }: PanelProps & { branch: BranchStep }) {
  const steps = branch.otherwise.steps.length;
  return (
    <PanelShell title="Otherwise" subtitle="Runs when no other path applies" onClose={onClose}>
      <p className="text-sm">
        The otherwise path has no condition.{" "}
        {steps === 0
          ? "With no steps, it stops the run."
          : `It has ${steps === 1 ? "1 step" : `${String(steps)} steps`}.`}{" "}
        Use “+” on the graph to give it steps.
      </p>
    </PanelShell>
  );
}
