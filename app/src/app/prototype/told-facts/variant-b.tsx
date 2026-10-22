"use client";

// PROTOTYPE, throwaway: what I've told Mycel as one chronological table, newest first. Each row
// says when, about whom, what, and what it replaced, with Delete at the end. Older notes can be
// listed as rows of their own; a filter narrows by words or by people and companies.
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { PRIVACY_NOTE, SUBJECTS, type OlderNote, type ToldFact } from "./fixtures";
import { UndoBar } from "./undo-bar";
import { useToldFacts } from "./use-told-facts";

type Kind = "all" | "person" | "company";
const KINDS: [Kind, string][] = [
  ["all", "Everything"],
  ["person", "People"],
  ["company", "Companies"],
];

type Row = { fact: ToldFact; note?: OlderNote; at: Date };

export function VariantB({ params }: VariantProps) {
  const state = useToldFacts();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [withOlder, setWithOlder] = useState(false);

  const rows: Row[] = state.facts
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

  return (
    <PrototypeMain wide>
      <PrototypeHeader title="What I've told Mycel" admin={params.as === "admin"}>
        <Badge variant="secondary">{state.facts.length}</Badge>
      </PrototypeHeader>
      <p className="max-w-2xl text-sm text-muted-foreground">{PRIVACY_NOTE}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="told-filter" className="sr-only">
          Filter what you&apos;ve told Mycel
        </label>
        <Input
          id="told-filter"
          value={query}
          placeholder="Filter by name or words"
          className="w-64"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Show">
          {KINDS.map(([value, label]) => (
            <Button
              key={value}
              size="xs"
              variant={kind === value ? "secondary" : "ghost"}
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <Switch checked={withOlder} onCheckedChange={setWithOlder} />
          Include older notes
        </label>
      </div>
      <UndoBar state={state} />
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
    </PrototypeMain>
  );
}
