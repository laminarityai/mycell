// PROTOTYPE, throwaway: Priya's waiting reviews once M11 lands (issue 67): Gmail drafts and an
// escalation beside held Calendar events and Docs suggested edits, plus the tasks Mycel added
// without a review. Titles, times and texts stand for what the page fetches live from the app;
// the review itself keeps only IDs, the guest list and the suggestion IDs (invariant 8).
import { NOW } from "../_shared/fixtures";

const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

export type App = "gmail" | "calendar" | "docs";

type Base = { id: string; workflowName: string; createdAt: Date; sharedWith?: string };

export type DraftReview = Base & {
  kind: "draft_reply";
  app: "gmail";
  message: { from: string; subject: string; text: string };
  draft: { to: string; subject: string; text: string };
};

export type EscalationReview = Base & {
  kind: "escalation";
  app: "gmail";
  reason: string;
  message: { from: string; subject: string; text: string };
};

export type EventReview = Base & {
  kind: "event";
  app: "calendar";
  title: string;
  start: Date;
  minutes: number;
  calendar: string;
  /** Kept on the review: who approving invites. */
  guests: string[];
};

export type SuggestionsReview = Base & {
  kind: "suggestions";
  app: "docs";
  docName: string;
  /** Mycel's suggestions still open in the doc, by the IDs the review keeps. */
  open: number;
  insertions: number;
  deletions: number;
  wordsAdded: number;
  wordsRemoved: number;
  sectionsTouched: number;
  sectionsTotal: number;
  /** The person's own suggestions in the doc: approving or declining leaves them alone. */
  othersInDoc: number;
  /** Accepting needs edit access; without it the review offers only the link. */
  canEdit: boolean;
};

export type ReviewFx = DraftReview | EscalationReview | EventReview | SuggestionsReview;

export const REVIEWS: ReviewFx[] = [
  {
    id: "rv-cal-1",
    kind: "event",
    app: "calendar",
    workflowName: "Book customer calls",
    createdAt: minutesAgo(25),
    title: "Call with Lena Park (Northwind)",
    start: new Date("2026-10-27T15:00:00Z"),
    minutes: 30,
    calendar: "priya@fernhill.co",
    guests: ["lena@northwind.io"],
  },
  {
    id: "rv-gm-1",
    kind: "draft_reply",
    app: "gmail",
    workflowName: "Reply to quote requests",
    createdAt: minutesAgo(118),
    message: {
      from: "buyer@acme.com",
      subject: "Quote for 400 kraft mailers?",
      text: "Hi, could you quote 400 kraft mailers, 10x13, delivered to Leeds by mid November?",
    },
    draft: {
      to: "buyer@acme.com",
      subject: "Re: Quote for 400 kraft mailers?",
      text: "Hi, thanks for asking. 400 kraft mailers at 10x13 come to £212.00 plus delivery to Leeds (£18.00). We can have them with you by Nov 12.\n\nBest,\nPriya",
    },
  },
  {
    id: "rv-doc-1",
    kind: "suggestions",
    app: "docs",
    workflowName: "Weekly status into the ops doc",
    createdAt: minutesAgo(190),
    sharedWith: "Shared with Ops",
    docName: "Ops weekly status",
    open: 4,
    insertions: 3,
    deletions: 1,
    wordsAdded: 142,
    wordsRemoved: 12,
    sectionsTouched: 2,
    sectionsTotal: 6,
    othersInDoc: 2,
    canEdit: true,
  },
  {
    id: "rv-cal-2",
    kind: "event",
    app: "calendar",
    workflowName: "Book customer calls",
    createdAt: minutesAgo(300),
    title: "Pallet pricing with Jo (Harbor Goods)",
    start: new Date("2026-10-28T17:00:00Z"),
    minutes: 45,
    calendar: "priya@fernhill.co",
    guests: ["jo@harborgoods.com", "sam@fernhill.co"],
  },
  {
    id: "rv-esc-1",
    kind: "escalation",
    app: "gmail",
    workflowName: "Reply to quote requests",
    createdAt: minutesAgo(60 * 22),
    reason: "Asks for a discount beyond the price sheet.",
    message: {
      from: "jo@harborgoods.com",
      subject: "Re: pallet pricing",
      text: "If we commit to 30 pallets a month, can you do 15% off?",
    },
  },
  {
    id: "rv-doc-2",
    kind: "suggestions",
    app: "docs",
    workflowName: "Weekly status into the ops doc",
    createdAt: minutesAgo(60 * 46),
    docName: "Q4 supplier review",
    open: 2,
    insertions: 2,
    deletions: 0,
    wordsAdded: 64,
    wordsRemoved: 0,
    sectionsTouched: 1,
    sectionsTotal: 4,
    othersInDoc: 0,
    canEdit: false,
  },
];

export const reviewById = (id: string) => REVIEWS.find((r) => r.id === id);

/** Tasks Mycel added today with no review (issue 67, stories 13 and 14). */
export const ADDED_TASKS = [
  { title: "Ship order 5521 to Acme", due: new Date("2026-10-23T00:00:00Z") },
  { title: "Confirm pallet count with Harbor Goods", due: new Date("2026-10-24T00:00:00Z") },
  { title: "Chase signed PO from Brightline", due: new Date("2026-10-28T00:00:00Z") },
].map((task) => ({ ...task, addedBy: "Follow-up tasks from orders" }));

/** One opened review per kind, for the variants that show them side by side. */
export const OPENED = {
  draft: REVIEWS[1] as DraftReview,
  event: REVIEWS[0] as EventReview,
  suggestions: REVIEWS[2] as SuggestionsReview,
};
