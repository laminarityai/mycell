"use client";

// PROTOTYPE, throwaway: the line that confirms a delete, with Undo.
import { Button } from "@/components/ui/button";
import type { ToldFactsState } from "./use-told-facts";

export function UndoBar({ state }: { state: ToldFactsState }) {
  if (state.lastDeleted === null) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm"
    >
      <span className="min-w-0">
        Deleted &ldquo;{state.lastDeleted}&rdquo;. Mycel no longer uses it.
      </span>
      <span className="flex gap-1">
        <Button variant="outline" size="sm" onClick={state.undo}>
          Undo
        </Button>
        <Button variant="ghost" size="sm" onClick={state.dismiss}>
          Dismiss
        </Button>
      </span>
    </div>
  );
}
