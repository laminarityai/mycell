"use client";

// PROTOTYPE, throwaway: what I've told Mycel as a drawer inside Ask Mycel, so the list is one
// click from the "remember that…" that fills it. The chat stays behind, dimmed; the note just
// saved leads the drawer, and older notes fold under each one.
import { NotebookPen, Trash2, X } from "lucide-react";
import { useState } from "react";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PrototypeHeader } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { ago } from "../ask/facts";
import { PRIVACY_NOTE, SUBJECTS } from "./fixtures";
import { ChatBehind } from "./chat-behind";
import { UndoBar } from "./undo-bar";
import { useToldFacts } from "./use-told-facts";

/** The told fact the chat's last "remember that…" saved. */
const JUST_SAVED = "t1";

export function VariantC({ params }: VariantProps) {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex h-[calc(100dvh-6.5rem)] flex-col">
      <div className="border-b px-4 py-3">
        <PrototypeHeader title="Ask Mycel" admin={params.as === "admin"}>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
            }}
          >
            <NotebookPen /> What I&apos;ve told Mycel
          </Button>
        </PrototypeHeader>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <ChatBehind
          onOpenDrawer={() => {
            setOpen(true);
          }}
        />
        {open ? (
          <>
            <button
              type="button"
              aria-label="Close the drawer"
              className="absolute inset-0 bg-black/20"
              onClick={() => {
                setOpen(false);
              }}
            />
            <Drawer
              onClose={() => {
                setOpen(false);
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function Drawer({ onClose }: { onClose: () => void }) {
  const state = useToldFacts();
  const facts = [...state.facts].sort((a, b) => b.toldAt.getTime() - a.toldAt.getTime());
  return (
    <aside
      aria-labelledby="drawer-title"
      className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l bg-background shadow-xl"
    >
      <div className="flex items-start justify-between gap-3 border-b p-4">
        <div className="flex flex-col gap-1">
          <h2 id="drawer-title" className="font-semibold">
            What I&apos;ve told Mycel
          </h2>
          <p className="text-xs text-muted-foreground">{PRIVACY_NOTE}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <UndoBar state={state} />
        {facts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Say &ldquo;remember that…&rdquo; in the chat and it lands here.
          </p>
        ) : null}
        <ul className="flex flex-col divide-y">
          {facts.map((fact) => {
            const subject = SUBJECTS[fact.subjectId];
            return (
              <li key={fact.id} className="flex flex-col gap-1.5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate font-medium text-foreground">{subject.name}</span>
                    <span className="truncate">{subject.key}</span>
                    {fact.id === JUST_SAVED ? <Badge>Just saved</Badge> : null}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete “${fact.statement}”`}
                    onClick={() => {
                      state.deleteFact(fact.id);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <p className="text-sm">{fact.statement}</p>
                <p className="text-xs text-muted-foreground">
                  <DateTime value={fact.toldAt} day />, {ago(fact.toldAt)}
                </p>
                {fact.replaced.length === 0 ? null : (
                  <details className="text-xs" open={fact.id === JUST_SAVED}>
                    <summary className="cursor-pointer text-muted-foreground">
                      Replaced{" "}
                      {fact.replaced.length === 1
                        ? "an older note"
                        : `${String(fact.replaced.length)} older notes`}
                    </summary>
                    <ul className="mt-1.5 flex flex-col gap-1.5 border-l pl-3">
                      {fact.replaced.map((note) => (
                        <li key={note.id} className="flex items-start justify-between gap-2">
                          <span className="text-muted-foreground">
                            <s>{note.statement}</s>{" "}
                            <span className="whitespace-nowrap">
                              (<DateTime value={note.toldAt} day />)
                            </span>
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Delete older note “${note.statement}”`}
                            onClick={() => {
                              state.deleteOlderNote(fact.id, note.id);
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
