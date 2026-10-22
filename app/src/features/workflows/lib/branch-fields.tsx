"use client";

// The side panel's fields for a branch: first match or every match, and its paths in the
// order they're checked, each reordered with move left and right, and a new one added.
import { Button } from "@/components/ui/button";
import { addPath, movePath, setBranchMode } from "@/features/spec/edit";
import { newPath } from "@/features/spec/new-step";
import { MAX_PATHS, type BranchStep } from "@/features/spec/types";
import type { PanelProps } from "./panel-shell";

const MODES = [
  {
    mode: "first",
    label: "First match",
    hint: "Check the paths left to right; run only the first that applies.",
  },
  {
    mode: "every",
    label: "Every match",
    hint: "Run every path that applies, one after another, left to right.",
  },
] as const;

export function BranchFields({
  branch,
  spec,
  edit,
  onSelect,
}: PanelProps & { branch: BranchStep }) {
  return (
    <>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">When several paths apply</legend>
        {MODES.map(({ mode, label, hint }) => (
          <label key={mode} className="flex items-start gap-2 rounded-md border p-2 text-sm">
            <input
              type="radio"
              name={`mode-${branch.id}`}
              checked={branch.mode === mode}
              className="mt-1"
              onChange={() => {
                edit((current) => setBranchMode(current, branch.id, mode));
              }}
            />
            <span>
              <span className="font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Paths, in the order they&apos;re checked</p>
        {branch.paths.map((path, index) => (
          <div
            key={path.id}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm"
          >
            <Button
              type="button"
              variant="link"
              size="xs"
              className="min-w-0 flex-1 justify-start truncate px-0 text-foreground"
              onClick={() => {
                onSelect({ kind: "path", id: path.id });
              }}
            >
              {path.name}
            </Button>
            <MoveButtons
              name={path.name}
              index={index}
              count={branch.paths.length}
              onMove={(by) => {
                edit((current) => movePath(current, path.id, by));
              }}
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="justify-start border-dashed font-normal text-muted-foreground"
          onClick={() => {
            onSelect({ kind: "path", id: branch.otherwise.id });
          }}
        >
          Otherwise ({stepCount(branch.otherwise.steps.length)})
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="self-start"
          disabled={branch.paths.length >= MAX_PATHS}
          onClick={() => {
            const path = newPath(spec, branch.id);
            edit((current) => addPath(current, branch.id, path));
            onSelect({ kind: "path", id: path.id });
          }}
        >
          Add a path
        </Button>
      </div>
    </>
  );
}

function stepCount(count: number): string {
  if (count === 0) return "stops";
  return count === 1 ? "1 step" : `${String(count)} steps`;
}

/** Move a path left or right among its branch's paths: the order they're checked in. */
export function MoveButtons({
  name,
  index,
  count,
  onMove,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (by: -1 | 1) => void;
}) {
  return (
    <span className="inline-flex shrink-0 gap-0.5">
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Move left"
        title={`Move ${name} left`}
        disabled={index === 0}
        onClick={() => {
          onMove(-1);
        }}
      >
        ←
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Move right"
        title={`Move ${name} right`}
        disabled={index === count - 1}
        onClick={() => {
          onMove(1);
        }}
      >
        →
      </Button>
    </span>
  );
}
