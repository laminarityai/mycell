"use client";

// PROTOTYPE, throwaway: what I've told Mycel as one chronological table, newest first. Each row
// says when, about whom, what, and what it replaced, with Delete at the end. Older notes can be
// listed as rows of their own; a filter narrows by words or by people and companies.
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { PRIVACY_NOTE } from "./fixtures";
import { ToldTable, toldRows, type Kind } from "./told-table";
import { UndoBar } from "./undo-bar";
import { useToldFacts } from "./use-told-facts";

const KINDS: [Kind, string][] = [
  ["all", "Everything"],
  ["person", "People"],
  ["company", "Companies"],
];

export function VariantB({ params }: VariantProps) {
  const state = useToldFacts();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [withOlder, setWithOlder] = useState(false);

  const rows = toldRows(state.facts, { query, withOlder, kind });

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
      <ToldTable state={state} rows={rows} />
    </PrototypeMain>
  );
}
