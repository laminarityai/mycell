"use client";

// PROTOTYPE, throwaway: the told facts' local state, shared by the variants (not their layout).
// Deleting a fact deletes its older notes with it; an older note can go on its own. The last
// delete can be undone. Nothing reaches a server.
import { useState } from "react";
import { TOLD_FACTS, type ToldFact } from "./fixtures";

export function useToldFacts() {
  const [facts, setFacts] = useState<ToldFact[]>(TOLD_FACTS);
  const [undo, setUndo] = useState<{ label: string; facts: ToldFact[] } | null>(null);

  function deleteFact(id: string) {
    const fact = facts.find((f) => f.id === id);
    if (fact === undefined) return;
    setUndo({ label: fact.statement, facts });
    setFacts(facts.filter((f) => f.id !== id));
  }

  function deleteOlderNote(factId: string, noteId: string) {
    const note = facts.find((f) => f.id === factId)?.replaced.find((n) => n.id === noteId);
    if (note === undefined) return;
    setUndo({ label: note.statement, facts });
    setFacts(
      facts.map((f) =>
        f.id === factId ? { ...f, replaced: f.replaced.filter((n) => n.id !== noteId) } : f,
      ),
    );
  }

  return {
    facts,
    deleteFact,
    deleteOlderNote,
    /** What the last delete removed, until it's undone or dismissed. */
    lastDeleted: undo?.label ?? null,
    undo: () => {
      if (undo !== null) setFacts(undo.facts);
      setUndo(null);
    },
    dismiss: () => {
      setUndo(null);
    },
  };
}

export type ToldFactsState = ReturnType<typeof useToldFacts>;
