// PROTOTYPE, throwaway: the facts and sources Ask Mycel's scripted answers cite. Sources are
// pointers (app, title, who, when, link), never content, as memory keeps them.
import { NOW } from "../_shared/fixtures";

export const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60_000);
export const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

/** "5 min ago", "3 h ago", "2 days ago", from the prototypes' fixed now. */
export function ago(date: Date): string {
  const minutes = Math.round((NOW.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${String(days)} days ago`;
  return `${String(Math.round(days / 7))} weeks ago`;
}

export type SourceApp = "Gmail" | "Drive" | "Calendar";

export type Source = {
  id: string;
  app: SourceApp;
  /** The email's subject, the file's name, the invite's title. */
  title: string;
  /** The sender, the file's owner, the invite's organizer. */
  who: string;
  at: Date;
  href: string;
};

export const SOURCES: Record<string, Source> = {
  s1: {
    id: "s1",
    app: "Gmail",
    title: "Re: 2027 pricing for kraft mailers",
    who: "Dana Ruiz",
    at: daysAgo(34),
    href: "https://mail.google.com/mail/u/0/#all/18f2a7c1",
  },
  s2: {
    id: "s2",
    app: "Drive",
    title: "Acme price agreement 2026–27",
    who: "Dana Ruiz",
    at: daysAgo(33),
    href: "https://docs.google.com/document/d/1Acme",
  },
  s3: {
    id: "s3",
    app: "Calendar",
    title: "Acme quarterly check-in",
    who: "Tom Becker",
    at: daysAgo(28),
    href: "https://calendar.google.com/calendar/event?eid=acme-q3",
  },
  s4: {
    id: "s4",
    app: "Gmail",
    title: "Invoice terms going forward",
    who: "Jordan Lee (acme.com)",
    at: daysAgo(26),
    href: "https://mail.google.com/mail/u/0/#all/18f3be02",
  },
  s5: {
    id: "s5",
    app: "Gmail",
    title: "News from Acme: we're growing",
    who: "Jordan Lee (acme.com)",
    at: daysAgo(19),
    href: "https://mail.google.com/mail/u/0/#all/18f4d913",
  },
  s6: {
    id: "s6",
    app: "Drive",
    title: "Customer list",
    who: "Sam Okafor",
    at: daysAgo(6),
    href: "https://docs.google.com/spreadsheets/d/1Customers",
  },
};

/** Disputed: conflicts with a fact from inside. Outside: only someone outside says so. */
export type FactMarker = "disputed" | "outside" | "told";

export type Fact = {
  id: string;
  statement: string;
  sourceIds: string[];
  marker?: FactMarker;
  /** For a disputed fact, the fact it conflicts with. */
  conflictsWith?: string;
};

export const FACTS: Record<string, Fact> = {
  f1: {
    id: "f1",
    statement: "Acme's price on kraft mailers is held at $0.42 each until March 31, 2027.",
    sourceIds: ["s1", "s2"],
  },
  f2: {
    id: "f2",
    statement: "Shipping is free on Acme orders over 2,000 units.",
    sourceIds: ["s2"],
  },
  f3: {
    id: "f3",
    statement: "Acme's invoice terms moved from net 30 to net 45 in October.",
    sourceIds: ["s1", "s3"],
  },
  f4: {
    id: "f4",
    statement: "Acme's invoice terms are net 60.",
    sourceIds: ["s4"],
    marker: "disputed",
    conflictsWith: "f3",
  },
  f5: {
    id: "f5",
    statement: "Acme is opening a second warehouse in Reno early in 2027.",
    sourceIds: ["s5"],
    marker: "outside",
  },
  f6: {
    id: "f6",
    statement: "Jordan Lee (jordan@acme.com) is Acme's buyer.",
    sourceIds: ["s1", "s6"],
  },
  f7: {
    id: "f7",
    statement: "Acme orders about every three weeks, usually 1,500 to 3,000 mailers.",
    sourceIds: ["s6"],
  },
  f8: {
    id: "f8",
    statement: "Acme's renewals go through Priya Shah, not Tom Becker.",
    sourceIds: [],
    marker: "told",
  },
};

export const MARKER_TEXT: Record<FactMarker, { label: string; hint: string }> = {
  disputed: {
    label: "Disputed",
    hint: "Only someone outside the company says this, and it conflicts with what we agreed.",
  },
  outside: { label: "Only from outside", hint: "Only someone outside the company says this." },
  told: { label: "You told Mycel", hint: "You told Mycel this. Only you see it." },
};

export const factSources = (fact: Fact) => fact.sourceIds.map((id) => SOURCES[id]);
