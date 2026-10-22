"use client";

// PROTOTYPE, throwaway: variant B's chronological table, shared with B2: the rows (each told
// fact, plus its older notes when asked), filtered by words and, in B, by kind, newest first.
import { Trash2 } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { SUBJECTS, type OlderNote, type ToldFact } from "./fixtures";
import type { ToldFactsState } from "./use-told-facts";

export type Kind = "all" | "person" | "company";

export type Row = { fact: ToldFact; note?: OlderNote; at: Date };

/** The table's rows: matching `query` (and `kind`), older notes too with `withOlder`. */
export function toldRows(
  facts: ToldFact[],
  { query, withOlder, kind = "all" }: { query: string; withOlder: boolean; kind?: Kind },
): Row[] {
  return facts
    .flatMap((fact): Row[] => [
      { fact, at: fact.toldAt },
      ...(withOlder ? fact.replaced.map((note) => ({ fact, note, at: note.toldAt })) : []),
    ])
    .filter(({ fact, note }) => {
      const subject = SUBJECTS[fact.subjectId];
      const text = `${subject.name} ${subject.key} ${(note ?? fact).statement}`.toLowerCase();
      return (kind === "all" || subject.kind === kind) && text.includes(query.toLowerCase());
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function ToldTable({ state, rows }: { state: ToldFactsState; rows: Row[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-32">Told</TableHead>
          <TableHead className="w-48">About</TableHead>
          <TableHead>What you told Mycel</TableHead>
          <TableHead className="w-72">Replaced</TableHead>
          <TableHead className="w-24">
            <span className="sr-only">Delete</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
              {state.facts.length === 0
                ? "You haven't told Mycel anything yet. Say “remember that…” in Ask Mycel."
                : "Nothing matches that filter."}
            </TableCell>
          </TableRow>
        ) : null}
        {rows.map(({ fact, note }) => {
          const subject = SUBJECTS[fact.subjectId];
          const older = fact.replaced.at(0);
          return (
            <TableRow
              key={note?.id ?? fact.id}
              className={cn(note !== undefined && "text-muted-foreground")}
            >
              <TableCell className="align-top">
                <DateTime value={(note ?? fact).toldAt} day />
              </TableCell>
              <TableCell className="align-top">
                <span className="block">{subject.name}</span>
                <span className="text-xs text-muted-foreground">{subject.key}</span>
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                {note === undefined ? (
                  fact.statement
                ) : (
                  <>
                    <span className="line-through">{note.statement}</span>{" "}
                    <Badge variant="outline">Older note</Badge>
                  </>
                )}
              </TableCell>
              <TableCell className="align-top text-xs whitespace-normal text-muted-foreground">
                {note !== undefined ? (
                  <>
                    Replaced <DateTime value={note.replacedAt} day />
                  </>
                ) : older === undefined ? (
                  "Nothing"
                ) : (
                  <>
                    <span className="line-through">{older.statement}</span>
                    {fact.replaced.length > 1
                      ? ` and ${String(fact.replaced.length - 1)} earlier`
                      : null}
                  </>
                )}
              </TableCell>
              <TableCell className="text-right align-top">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete “${(note ?? fact).statement}”`}
                  onClick={() => {
                    if (note === undefined) state.deleteFact(fact.id);
                    else state.deleteOlderNote(fact.id, note.id);
                  }}
                >
                  <Trash2 /> Delete
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
