// PROTOTYPE, throwaway: Ask Mycel's second scripted conversation, "What's waiting for me?". It
// lists the person's waiting reviews and switched-on workflows (paused ones say why), then shows
// the three refusals: a paused workflow, a message whose run is under way, a do-not-learn address.
import { PAUSED_TEXT, workflowById } from "../_shared/fixtures";
import { QUOTE_MESSAGE, STARTED_RUN_ID, type Message, type WaitingReview } from "./conversation";
import { minutesAgo } from "./facts";

export const REVIEWS_HREF = "/prototype/review-cards";

/** Six, as the nav's Reviews count says. */
export const WAITING_REVIEWS: WaitingReview[] = [
  {
    id: "rv-1",
    workflowId: "wf-quotes",
    kind: "Draft reply",
    title: "Re: Quote for 400 kraft mailers?",
    waitingSince: minutesAgo(38),
  },
  {
    id: "rv-2",
    workflowId: "wf-quotes",
    kind: "Draft reply",
    title: "Re: pallet pricing",
    waitingSince: minutesAgo(140),
  },
  {
    id: "rv-3",
    workflowId: "wf-calls",
    kind: "Calendar invite",
    title: "Call with Lena Park (Northwind), Thu 2pm",
    waitingSince: minutesAgo(26 * 60),
  },
  {
    id: "rv-4",
    workflowId: "wf-quotes",
    kind: "Draft reply",
    title: "Re: Can we get a call Thursday?",
    waitingSince: minutesAgo(29 * 60),
  },
  {
    id: "rv-5",
    workflowId: "wf-followups",
    kind: "Task",
    title: "Follow up on order 5521",
    waitingSince: minutesAgo(50 * 60),
  },
  {
    id: "rv-6",
    workflowId: "wf-calls",
    kind: "Calendar invite",
    title: "Call with Jordan Lee (Acme), Mon 10am",
    waitingSince: minutesAgo(3 * 24 * 60),
  },
];

/** The person's own switched-on workflows: those that run on their connection. */
export const MY_WORKFLOW_IDS = ["wf-quotes", "wf-calls", "wf-followups"];

const followups = workflowById("wf-followups");
const ORDER_MESSAGE = "“Order 5521 confirmed” from orders@acme.com";

const ask = (id: string, at: Date, text: string): Message => ({
  id,
  role: "person",
  at,
  parts: [{ kind: "text", text }],
});

export const WAITING_SCRIPT: Message[] = [
  ask("w1", minutesAgo(30), "What's waiting for me?"),
  {
    id: "w2",
    role: "mycel",
    at: minutesAgo(30),
    parts: [
      { kind: "text", text: "Six reviews wait for you. Approve, edit or decline them on Reviews." },
      { kind: "reviews", reviews: WAITING_REVIEWS },
    ],
  },
  ask("w3", minutesAgo(28), "Which workflows are running for me?"),
  {
    id: "w4",
    role: "mycel",
    at: minutesAgo(28),
    parts: [
      { kind: "text", text: "You've switched on three. Two are paused:" },
      { kind: "workflows", workflowIds: MY_WORKFLOW_IDS },
    ],
  },
  ask("w5", minutesAgo(25), `Run ${followups?.name ?? ""} on the Order 5521 email.`),
  {
    id: "w6",
    role: "mycel",
    at: minutesAgo(25),
    parts: [
      {
        kind: "refusal",
        reason: "paused",
        text: `I can't run ${followups?.name ?? ""} on ${ORDER_MESSAGE}: it's paused (${PAUSED_TEXT.failures}). It runs again once an admin resumes it.`,
        link: { href: "/prototype/workflow-status", label: "See why it's paused" },
      },
    ],
  },
  ask("w7", minutesAgo(22), "Run Reply to quote requests on the Acme quote request again."),
  {
    id: "w8",
    role: "mycel",
    at: minutesAgo(22),
    parts: [
      {
        kind: "refusal",
        reason: "underWay",
        text: `Reply to quote requests is already working on “${QUOTE_MESSAGE.subject}”. I won't start a second run, so you don't get two drafts.`,
        link: {
          href: `/prototype/run?run=${STARTED_RUN_ID}`,
          label: `Follow run ${STARTED_RUN_ID}`,
        },
      },
    ],
  },
  ask("w9", minutesAgo(20), "Remember that alex@riveradesign.me prefers texts to email."),
  {
    id: "w10",
    role: "mycel",
    at: minutesAgo(20),
    parts: [
      {
        kind: "refusal",
        reason: "doNotLearn",
        text: "I can't remember anything about alex@riveradesign.me: an admin asked Mycel to forget that person, so nothing about them is kept.",
      },
    ],
  },
];

export const REFUSAL_TITLE = {
  paused: "Paused workflow",
  underWay: "Already running",
  doNotLearn: "Mycel forgets this person",
  noConnection: "Needs Google",
} as const;
