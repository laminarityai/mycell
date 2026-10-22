"use client";

// PROTOTYPE, throwaway: variant C's reply cards. Facts are cards with their sources as chips; a
// disputed fact sits beside the fact it conflicts with; a summary is a profile, not a paragraph.
import Link from "next/link";
import { Building2, CalendarDays, FileText, Mail, ShieldAlert } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Part, ToldSubject } from "./conversation";
import { FACTS, MARKER_TEXT, factSources, type Fact, type SourceApp } from "./facts";

const ICON: Record<SourceApp, typeof Mail> = {
  Gmail: Mail,
  Drive: FileText,
  Calendar: CalendarDays,
};

export function SourceChips({ fact }: { fact: Fact }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {factSources(fact).map((s) => {
        const Icon = ICON[s.app];
        return (
          <a
            key={s.id}
            href={s.href}
            target="_blank"
            rel="noreferrer"
            title={`${s.who}, ${s.at.toISOString().slice(0, 10)}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs hover:bg-muted"
          >
            <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{s.title}</span>
          </a>
        );
      })}
    </div>
  );
}

function FactCard({ fact, className }: { fact: Fact; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border p-3 text-sm", className)}>
      {fact.marker === undefined ? null : (
        <Badge variant={fact.marker === "disputed" ? "destructive" : "outline"}>
          {MARKER_TEXT[fact.marker].label}
        </Badge>
      )}
      <p>{fact.statement}</p>
      {fact.marker === "outside" ? (
        <p className="text-xs text-muted-foreground">{MARKER_TEXT.outside.hint}</p>
      ) : null}
      <SourceChips fact={fact} />
    </div>
  );
}

/** A disputed fact beside the inside fact it conflicts with: both stand until someone settles it. */
function ConflictCard({ inside, disputed }: { inside: Fact; disputed: Fact }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3 text-sm sm:col-span-2">
      <p className="font-medium">These two disagree, so treat the terms as unsettled.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <FactCard fact={inside} className="bg-background" />
        <FactCard fact={disputed} className="bg-destructive/5" />
      </div>
    </div>
  );
}

export function FactGrid({ factIds }: { factIds: string[] }) {
  // A disputed fact's partner, when the answer cites both.
  const partnerOf = (id: string) => {
    const other = FACTS[id].conflictsWith;
    return other !== undefined && factIds.includes(other) ? other : undefined;
  };
  const paired = new Set(factIds.flatMap((id) => partnerOf(id) ?? []));
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {factIds.map((id) => {
        if (paired.has(id)) return null;
        const partner = partnerOf(id);
        return partner === undefined ? (
          <FactCard key={id} fact={FACTS[id]} />
        ) : (
          <ConflictCard key={id} inside={FACTS[partner]} disputed={FACTS[id]} />
        );
      })}
    </div>
  );
}

const SECTIONS: [string, string[]][] = [
  ["Who", ["f6", "f8"]],
  ["Prices and terms", ["f1", "f2", "f3", "f4"]],
  ["Orders", ["f7"]],
  ["Plans", ["f5"]],
];

export function ProfileCard({ subject, factIds }: { subject: ToldSubject; factIds: string[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-3">
        <span className="flex size-9 items-center justify-center rounded-md bg-background ring-1 ring-border">
          <Building2 className="size-4" aria-hidden />
        </span>
        <div>
          <p className="font-semibold">{subject.name}</p>
          <p className="text-xs text-muted-foreground">
            {subject.kind}, {subject.key}. From the {String(factIds.length)} facts you can see.
          </p>
        </div>
      </div>
      <dl className="divide-y">
        {SECTIONS.map(([title, ids]) => {
          const shown = ids.filter((id) => factIds.includes(id));
          if (shown.length === 0) return null;
          return (
            <div key={title} className="grid gap-2 px-4 py-3 sm:grid-cols-[9rem_1fr]">
              <dt className="text-xs font-medium text-muted-foreground">{title}</dt>
              <dd className="flex flex-col gap-2">
                {shown.map((id) => (
                  <div key={id} className="flex flex-col gap-1 text-sm">
                    <p>
                      {FACTS[id].statement}{" "}
                      {FACTS[id].marker === undefined ? null : (
                        <Badge
                          variant={FACTS[id].marker === "disputed" ? "destructive" : "outline"}
                        >
                          {MARKER_TEXT[FACTS[id].marker].label}
                        </Badge>
                      )}
                    </p>
                    <SourceChips fact={FACTS[id]} />
                  </div>
                ))}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export function UnknownCard({ text, onTell }: { text: string; onTell: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-4 text-sm">
      <p className="font-medium">Memory doesn&apos;t know</p>
      <p className="text-muted-foreground">{text}</p>
      <Button variant="outline" size="sm" onClick={onTell}>
        Tell Mycel
      </Button>
    </div>
  );
}

export function RememberedCard({ part }: { part: Extract<Part, { kind: "remembered" }> }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>Saved</Badge>
        <span>
          about <strong>{part.about.name}</strong> ({part.about.kind.toLowerCase()},{" "}
          {part.about.key}), only you see it
        </span>
      </div>
      <p className="text-base">{part.statement}</p>
      {part.replaced === undefined ? null : (
        <p className="text-muted-foreground">
          Replaces <s>{part.replaced.statement}</s> (told <DateTime value={part.replaced.at} day />
          ), kept as history.
        </p>
      )}
      <Link href="/prototype/told-facts" className="self-start text-xs underline">
        What I&apos;ve told Mycel
      </Link>
    </div>
  );
}

export function ScreenedChip({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {text}
    </p>
  );
}
