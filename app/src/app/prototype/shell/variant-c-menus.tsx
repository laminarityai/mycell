// PROTOTYPE, throwaway: variant C's two client pieces: the "Admin" (or, for a member, "More")
// menu holding every link that isn't daily, and the Ask Mycel launcher, a field-shaped button in
// the bar that opens a docked chat panel from any page (⌘K too).
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { GROUP_LABELS, itemsFor, type NavGroup } from "./nav-model";
import { NavCount } from "./shell-parts";

const MENU_GROUPS: NavGroup[] = ["company", "accounts"];

export function MoreMenu({ admin, out }: { admin: boolean; out: boolean }) {
  const [open, setOpen] = useState(false);
  const items = itemsFor(admin).filter((item) => !item.daily);
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {admin ? "Admin" : "More"}
        {out && admin ? <span className="size-1.5 rounded-full bg-destructive" /> : null}
        <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
      </Button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => {
              setOpen(false);
            }}
          />
          <div className="absolute right-0 z-50 mt-1 flex w-64 flex-col gap-3 rounded-lg border bg-popover p-2 shadow-lg">
            {MENU_GROUPS.map((group) => {
              const links = items.filter((item) => item.group === group);
              if (links.length === 0) return null;
              return (
                <div key={group} className="flex flex-col">
                  <p className="px-2 py-1 text-xs text-muted-foreground">{GROUP_LABELS[group]}</p>
                  {links.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <Icon className="size-4 text-muted-foreground" aria-hidden />
                        <span className="flex-1">{item.label}</span>
                        {item.key === "credits" && out ? (
                          <span className="text-xs font-medium text-destructive">Out</span>
                        ) : null}
                        {item.count === undefined ? null : <NavCount {...item.count} />}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

const SUGGESTIONS = [
  "Why didn't my quote reply go out this morning?",
  "What's waiting for me today?",
  "Which workflows are paused, and why?",
];

export function AskLauncher() {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function ask(question: string) {
    if (question.trim() === "") return;
    setAsked([...asked, question]);
    setDraft("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="flex h-8 w-56 items-center gap-2 rounded-md border bg-muted/50 px-2.5 text-sm text-muted-foreground hover:bg-muted"
      >
        <Sparkles className="size-4" aria-hidden />
        <span className="flex-1 text-left">Ask Mycel</span>
        <kbd className="rounded border bg-background px-1 text-[10px]">⌘K</kbd>
      </button>
      {open ? (
        <aside
          aria-label="Ask Mycel"
          className="fixed top-0 right-0 z-50 flex h-svh w-full max-w-sm flex-col border-l bg-background shadow-2xl"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="flex items-center gap-2 font-medium">
              <Sparkles className="size-4" aria-hidden /> Ask Mycel
            </p>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              onClick={() => {
                setOpen(false);
              }}
            >
              <X />
            </Button>
          </div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm">
            <p className="text-muted-foreground">
              Ask about your workflows, runs and reviews. It stays open while you move between
              pages.
            </p>
            {asked.length === 0
              ? SUGGESTIONS.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => {
                      ask(question);
                    }}
                    className="rounded-md border px-3 py-2 text-left hover:bg-muted"
                  >
                    {question}
                  </button>
                ))
              : asked.map((question, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <p className="self-end rounded-lg bg-primary px-3 py-2 text-primary-foreground">
                      {question}
                    </p>
                    <p className="rounded-lg bg-muted px-3 py-2">
                      (Prototype) Mycel would answer here, linking the runs and reviews it read.
                    </p>
                  </div>
                ))}
          </div>
          <form
            className="flex gap-2 border-t p-3"
            onSubmit={(event) => {
              event.preventDefault();
              ask(draft);
            }}
          >
            <Input
              aria-label="Your question"
              placeholder="Ask anything about your work"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
            />
            <Button type="submit">Ask</Button>
          </form>
        </aside>
      ) : null}
    </>
  );
}
