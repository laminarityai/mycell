"use client";

// PROTOTYPE, throwaway: round 2 of variant B inside the chosen sidebar shell, under Ask Mycel
// since it's reached from there. The same chronological table, filtered by words alone (no
// people/companies selector), with older notes behind a switch and a link back to the chat.
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { VariantProps } from "../_shared/prototype-page";
import { SidebarShell } from "../_shared/sidebar-shell";
import { PRIVACY_NOTE } from "./fixtures";
import { ToldTable, toldRows } from "./told-table";
import { UndoBar } from "./undo-bar";
import { useToldFacts } from "./use-told-facts";

export function VariantB2({ params }: VariantProps) {
  const state = useToldFacts();
  const [query, setQuery] = useState("");
  const [withOlder, setWithOlder] = useState(false);
  const rows = toldRows(state.facts, { query, withOlder });

  return (
    <SidebarShell params={params} current="ask" width="wide">
      <div className="flex flex-col gap-2">
        <Link
          href="/prototype/ask"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> Ask Mycel
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">What I&apos;ve told Mycel</h1>
          <Badge variant="secondary">{state.facts.length}</Badge>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">{PRIVACY_NOTE}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <label htmlFor="told-filter-b2" className="sr-only">
            Filter what you&apos;ve told Mycel
          </label>
          <Input
            id="told-filter-b2"
            type="search"
            value={query}
            placeholder="Filter by name or words"
            className="w-72 pl-8"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={withOlder} onCheckedChange={setWithOlder} />
          Include older notes
        </label>
      </div>
      <UndoBar state={state} />
      <ToldTable state={state} rows={rows} />
    </SidebarShell>
  );
}
