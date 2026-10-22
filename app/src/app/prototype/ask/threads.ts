// PROTOTYPE, throwaway: the conversation list and each conversation's messages. Two are scripted
// in full; the rest are short. With no Google connection, message search and runs turn into the
// notice that they need one.
import {
  SCRIPT,
  type AnswerLine,
  type ConversationSummary,
  type Message,
  type Part,
} from "./conversation";
import { daysAgo, minutesAgo } from "./facts";
import { WAITING_SCRIPT } from "./waiting";

export const CONVERSATIONS: ConversationSummary[] = [
  { id: "c1", title: "Acme's terms and renewals", updatedAt: minutesAgo(6) },
  { id: "c5", title: "What's waiting for me?", updatedAt: minutesAgo(20) },
  { id: "c2", title: "Brightline invoice #88213", updatedAt: daysAgo(1) },
  { id: "c3", title: "When can Northwind take a call?", updatedAt: daysAgo(4) },
  { id: "c4", title: "Harbor Goods pallet sizes", updatedAt: daysAgo(12) },
];

const short = (id: string, question: string, answer: AnswerLine[], at: Date): Message[] => [
  { id: `${id}-q`, role: "person", at, parts: [{ kind: "text", text: question }] },
  { id: `${id}-a`, role: "mycel", at, parts: [{ kind: "answer", lines: answer }] },
];

const THREADS: Record<string, Message[]> = {
  c1: SCRIPT,
  c5: WAITING_SCRIPT,
  c2: short(
    "c2",
    "Has Brightline's October invoice been paid?",
    [
      {
        text: "Memory doesn't know whether invoice #88213 has been paid: nothing you can see says so.",
      },
    ],
    daysAgo(1),
  ),
  c3: short(
    "c3",
    "When can Northwind take a call?",
    [{ text: "Lena at Northwind is free Thursday afternoons." }],
    daysAgo(4),
  ),
  c4: short(
    "c4",
    "What pallet sizes does Harbor Goods take?",
    [{ text: "Memory doesn't know Harbor Goods' pallet sizes." }],
    daysAgo(12),
  ),
};

/** Without a Google connection, a part that needs the person's mail becomes the notice. */
function withoutGoogle(part: Part): Part[] {
  if (part.kind === "messages") return [];
  if (part.kind === "proposedRun" || (part.kind === "refusal" && part.reason === "underWay")) {
    return [
      {
        kind: "refusal",
        reason: "noConnection",
        text: "I can't run a workflow for you yet: it would act through your Google connection, and you haven't connected Google.",
        link: { href: "/connections", label: "Connect Google" },
      },
    ];
  }
  if (part.kind === "text" && part.text.startsWith("Three messages"))
    return [{ kind: "noConnection" }];
  return [part];
}

/** Every conversation's messages, as the viewer's Google connection allows. */
export function threadsFor(google: string): Record<string, Message[]> {
  if (google !== "none") return THREADS;
  return Object.fromEntries(
    Object.entries(THREADS).map(([id, messages]) => [
      id,
      messages.map((m) => ({ ...m, parts: m.parts.flatMap(withoutGoogle) })),
    ]),
  );
}

export const GOOGLE_TOGGLE = { param: "google", options: ["connected", "none"] };
