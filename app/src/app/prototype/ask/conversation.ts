// PROTOTYPE, throwaway: Ask Mycel's scripted conversations. One long conversation shows every
// kind of reply the spec asks for; the others are short, for the list. No model: a variant that
// sends a message gets the canned reply at the bottom.
import { daysAgo, minutesAgo } from "./facts";

/** One sentence of an answer, and the fact it cites, if any. */
export type AnswerLine = { text: string; factId?: string };

export type FoundMessage = { id: string; from: string; subject: string; at: Date };

export type ToldSubject = { kind: "Company" | "Person"; name: string; key: string };

export type Part =
  | { kind: "text"; text: string }
  | { kind: "answer"; lines: AnswerLine[] }
  | { kind: "unknown"; text: string }
  | { kind: "summary"; subject: ToldSubject; intro: string; factIds: string[] }
  | { kind: "messages"; query: string; messages: FoundMessage[] }
  | { kind: "proposedRun"; workflowId: string; message: FoundMessage }
  | {
      kind: "remembered";
      statement: string;
      about: ToldSubject;
      replaced?: { statement: string; at: Date };
    }
  | { kind: "removed" }
  | { kind: "outOfCredits" }
  | { kind: "screened"; text: string }
  | { kind: "reviews"; reviews: WaitingReview[] }
  | { kind: "workflows"; workflowIds: string[] }
  | {
      kind: "refusal";
      reason: "paused" | "underWay" | "doNotLearn" | "noConnection";
      text: string;
      link?: { href: string; label: string };
    }
  | { kind: "noConnection" };

/** A review waiting for the person, as `list_reviews` shows it: workflow, kind, age, link. */
export type WaitingReview = {
  id: string;
  workflowId: string;
  kind: "Draft reply" | "Calendar invite" | "Doc edit" | "Task";
  title: string;
  waitingSince: Date;
};

export type Message = { id: string; role: "person" | "mycel"; at: Date; parts: Part[] };

export type ConversationSummary = { id: string; title: string; updatedAt: Date };

const ACME: ToldSubject = { kind: "Company", name: "Acme", key: "acme.com" };

/** The run the scripted proposal starts, for its links. */
export const STARTED_RUN_ID = "r-1041";

export const QUOTE_MESSAGE: FoundMessage = {
  id: "m1",
  from: "buyer@acme.com",
  subject: "Quote for 400 kraft mailers?",
  at: minutesAgo(26 * 60),
};

export const SCRIPT: Message[] = [
  {
    id: "1",
    role: "person",
    at: minutesAgo(190),
    parts: [{ kind: "text", text: "What did we agree with Acme last month?" }],
  },
  {
    id: "2",
    role: "mycel",
    at: minutesAgo(190),
    parts: [
      {
        kind: "answer",
        lines: [
          {
            text: "In September you agreed to hold Acme's price on kraft mailers at $0.42 each until the end of March.",
            factId: "f1",
          },
          { text: "Shipping stays free on their orders over 2,000 units.", factId: "f2" },
          { text: "Their invoice terms moved from net 30 to net 45.", factId: "f3" },
          {
            text: "Acme's buyer has since written that the terms are net 60. Only Acme says so, and it conflicts with net 45, so treat it as unsettled.",
            factId: "f4",
          },
          {
            text: "Acme also says it's opening a second warehouse in Reno early next year.",
            factId: "f5",
          },
        ],
      },
      {
        kind: "screened",
        text: "I left out one email from billing@acme-payments.co: it contained instructions aimed at Mycel.",
      },
    ],
  },
  {
    id: "3",
    role: "person",
    at: minutesAgo(184),
    parts: [{ kind: "text", text: "Who handles Acme's renewals?" }],
  },
  {
    id: "4",
    role: "mycel",
    at: minutesAgo(184),
    parts: [
      {
        kind: "unknown",
        text: "Memory doesn't know who handles Acme's renewals: nothing you can see says so. If you know, tell me and I'll remember it.",
      },
    ],
  },
  {
    id: "5",
    role: "person",
    at: minutesAgo(181),
    parts: [{ kind: "text", text: "Remember that Acme's renewals go through Priya, not Tom." }],
  },
  {
    id: "6",
    role: "mycel",
    at: minutesAgo(181),
    parts: [
      {
        kind: "remembered",
        statement: "Acme's renewals go through Priya Shah, not Tom Becker.",
        about: ACME,
        replaced: { statement: "Acme's renewals go through Tom Becker.", at: daysAgo(49) },
      },
    ],
  },
  {
    id: "7",
    role: "person",
    at: minutesAgo(170),
    parts: [{ kind: "text", text: "Tell me about Acme." }],
  },
  {
    id: "8",
    role: "mycel",
    at: minutesAgo(170),
    parts: [
      {
        kind: "summary",
        subject: ACME,
        intro: "Here's Acme, built only from the facts you can see.",
        factIds: ["f6", "f7", "f1", "f2", "f3", "f4", "f5", "f8"],
      },
    ],
  },
  {
    id: "9",
    role: "person",
    at: minutesAgo(150),
    parts: [{ kind: "text", text: "What did Harbor Goods say about pallet pricing?" }],
  },
  { id: "10", role: "mycel", at: minutesAgo(150), parts: [{ kind: "removed" }] },
  {
    id: "11",
    role: "person",
    at: minutesAgo(42),
    parts: [{ kind: "text", text: "Find the quote request Acme sent this week." }],
  },
  {
    id: "12",
    role: "mycel",
    at: minutesAgo(42),
    parts: [
      { kind: "text", text: "Three messages from acme.com this week in your mail:" },
      {
        kind: "messages",
        query: "from acme.com, this week",
        messages: [
          QUOTE_MESSAGE,
          {
            id: "m2",
            from: "jordan@acme.com",
            subject: "Re: delivery window next week",
            at: minutesAgo(50 * 60),
          },
          {
            id: "m3",
            from: "orders@acme.com",
            subject: "Order 5521 confirmed",
            at: minutesAgo(70 * 60),
          },
        ],
      },
    ],
  },
  {
    id: "13",
    role: "person",
    at: minutesAgo(40),
    parts: [{ kind: "text", text: "Draft the usual reply to the first one." }],
  },
  {
    id: "14",
    role: "mycel",
    at: minutesAgo(40),
    parts: [{ kind: "proposedRun", workflowId: "wf-quotes", message: QUOTE_MESSAGE }],
  },
  {
    id: "15",
    role: "person",
    at: minutesAgo(6),
    parts: [{ kind: "text", text: "How often does Brightline order?" }],
  },
  { id: "16", role: "mycel", at: minutesAgo(6), parts: [{ kind: "outOfCredits" }] },
];

/** What any sent message gets back in the prototype: a plain answer that types in. */
export const CANNED_REPLY =
  "This is a prototype, so I can't answer new questions yet. In Ask Mycel the answer streams in here as it's written, citing the emails, files and invites its facts came from.";

export const DISCLOSURE =
  "You're talking to Mycel, an AI. It answers only from what you can see in memory and your own mail, and it can be wrong, so check its sources. Being an admin doesn't let it see more. Only you can see this conversation.";

export const OUT_OF_CREDITS =
  "Mycel is out of credits, so it stopped before answering. Ask an admin to add credits on the Credits page.";

export const REMOVED = "Removed: a connection this reply used was disconnected.";

export const NO_CONNECTION =
  "Message search needs your Google connection, and you haven't connected Google yet. Until you do, Mycel answers from company-wide memory only.";
