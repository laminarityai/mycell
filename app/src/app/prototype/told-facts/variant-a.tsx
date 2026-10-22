"use client";

// PROTOTYPE, throwaway: what I've told Mycel, grouped by who or what it's about. Each person or
// company is a section; its current notes lead, and the older notes they replaced sit beneath
// as a short history.
import Link from "next/link";
import { Building2, Trash2, UserRound } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { Button } from "@/components/ui/button";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { ago } from "../ask/facts";
import { PRIVACY_NOTE, SUBJECTS, type ToldFact } from "./fixtures";
import { UndoBar } from "./undo-bar";
import { useToldFacts, type ToldFactsState } from "./use-told-facts";

export function VariantA({ params }: VariantProps) {
  const state = useToldFacts();
  // Subjects in the order of their newest note.
  const groups = new Map<string, ToldFact[]>();
  for (const fact of state.facts)
    groups.set(fact.subjectId, [...(groups.get(fact.subjectId) ?? []), fact]);

  return (
    <PrototypeMain>
      <PrototypeHeader title="What I've told Mycel" admin={params.as === "admin"} />
      <p className="text-sm text-muted-foreground">{PRIVACY_NOTE}</p>
      <UndoBar state={state} />
      {groups.size === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          You haven&apos;t told Mycel anything. In{" "}
          <Link href="/prototype/ask" className="underline">
            Ask Mycel
          </Link>
          , say &ldquo;remember that…&rdquo; and it shows up here.
        </p>
      ) : null}
      <div className="flex flex-col gap-8">
        {[...groups].map(([subjectId, facts]) => {
          const subject = SUBJECTS[subjectId];
          const Icon = subject.kind === "person" ? UserRound : Building2;
          return (
            <section key={subjectId} aria-labelledby={`s-${subjectId}`} className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div>
                  <h2 id={`s-${subjectId}`} className="font-semibold">
                    {subject.name}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {subject.kind === "person" ? "Person" : "Company"}, {subject.key}
                  </p>
                </div>
                <ul className="flex flex-col gap-3">
                  {facts.map((fact) => (
                    <FactEntry key={fact.id} fact={fact} state={state} />
                  ))}
                </ul>
              </div>
            </section>
          );
        })}
      </div>
    </PrototypeMain>
  );
}

function FactEntry({ fact, state }: { fact: ToldFact; state: ToldFactsState }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm">{fact.statement}</p>
          <p className="text-xs text-muted-foreground">
            Told <DateTime value={fact.toldAt} day /> ({ago(fact.toldAt)})
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            state.deleteFact(fact.id);
          }}
        >
          <Trash2 /> Delete
        </Button>
      </div>
      {fact.replaced.length === 0 ? null : (
        <ol
          className="ml-1 flex flex-col gap-2 border-l-2 pl-3"
          aria-label="Older notes it replaced"
        >
          {fact.replaced.map((note) => (
            <li key={note.id} className="group flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm text-muted-foreground line-through decoration-muted-foreground/50">
                  {note.statement}
                </p>
                <p className="text-xs text-muted-foreground">
                  Told <DateTime value={note.toldAt} day />, replaced{" "}
                  <DateTime value={note.replacedAt} day />
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete older note “${note.statement}”`}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => {
                  state.deleteOlderNote(fact.id, note.id);
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
