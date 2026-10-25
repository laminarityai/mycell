"use client";

// "What I've told Mycel"'s table (variant B of the prototype): each note the person told Mycel,
// newest first, with who or what it's about, what it replaced, and Delete. A delete shows a
// line with Undo, which brings the note back while its window lasts; the page is read again
// after each, so the rows are always the server's.
import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { DateTime } from "@/components/date-time";
import { FormError } from "@/components/form-error";
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
import type { DeletedToldFact, ToldNote } from "@/features/memory/types";
import { deleteToldFactAction, restoreToldFactAction } from "../actions";

export function ToldTable({
  notes,
  total,
}: {
  /** The rows the filter picked. */
  notes: ToldNote[];
  /** How many current notes the person has, whatever the filter. */
  total: number;
}) {
  const [deleted, setDeleted] = useState<DeletedToldFact | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const remove = (note: ToldNote) => {
    startTransition(async () => {
      const result = await deleteToldFactAction(note.id);
      if ("deleted" in result) {
        setDeleted(result.deleted);
        setError(undefined);
      } else setError(result.error);
    });
  };
  const undo = (note: DeletedToldFact) => {
    startTransition(async () => {
      const result = await restoreToldFactAction(note.id);
      setDeleted(null);
      setError(result.error);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {deleted === null ? null : (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm"
        >
          <span className="min-w-0">
            Deleted &ldquo;{deleted.statement}&rdquo;. Mycel no longer uses it.
          </span>
          <span className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                undo(deleted);
              }}
            >
              Undo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDeleted(null);
              }}
            >
              Dismiss
            </Button>
          </span>
        </div>
      )}
      <FormError message={error} />
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
          {notes.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                {total === 0
                  ? "You haven't told Mycel anything yet. Say “remember that…” in Ask Mycel."
                  : "Nothing matches that filter."}
              </TableCell>
            </TableRow>
          ) : null}
          {notes.map((note) => {
            const older = note.replacedAt !== null;
            return (
              <TableRow key={note.id} className={older ? "text-muted-foreground" : undefined}>
                <TableCell className="align-top">
                  <DateTime value={note.toldAt} day />
                </TableCell>
                <TableCell className="align-top">
                  <span className="block">{note.about.name}</span>
                  {note.about.key === null || note.about.key === note.about.name ? null : (
                    <span className="text-xs text-muted-foreground">{note.about.key}</span>
                  )}
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  {older ? (
                    <>
                      <span className="line-through">{note.statement}</span>{" "}
                      <Badge variant="outline">Older note</Badge>
                    </>
                  ) : (
                    note.statement
                  )}
                </TableCell>
                <TableCell className="align-top text-xs whitespace-normal text-muted-foreground">
                  <Replaced note={note} />
                </TableCell>
                <TableCell className="text-right align-top">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    aria-label={`Delete “${note.statement}”`}
                    onClick={() => {
                      remove(note);
                    }}
                  >
                    <Trash2 aria-hidden /> Delete
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function Replaced({ note }: { note: ToldNote }) {
  if (note.replacedAt !== null) {
    return (
      <>
        Replaced <DateTime value={note.replacedAt} day />
      </>
    );
  }
  if (note.replaced === null) return <>Nothing</>;
  const { statement, earlier } = note.replaced;
  return (
    <>
      <span className="line-through">{statement}</span>
      {earlier === 0 ? null : ` and ${String(earlier)} earlier`}
    </>
  );
}
