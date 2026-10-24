// What each trigger declares (a trigger is one of the parts an app plugs in with, ADR-0013): the
// app it watches, what it starts a run on, the facts a condition may test about that item
// (ADR-0015), and the fields a step may read from it. A Gmail message's or an invite's facts are
// read from the item inside the step that tests them, and never stored (invariant 8). Pure, so
// client code may import it.
import type { ConditionField, Spec } from "./types";

export type TriggerType = Spec["trigger"]["type"];

/** Every trigger type, in the order the editor offers them. */
export const triggerTypes: readonly TriggerType[] = [
  "gmail.message_received",
  "calendar.invite_received",
];

/** What a trigger declares about itself. */
export type TriggerInfo = {
  /** The app it watches, as admins name it; a connection must be granted it. */
  app: "Gmail" | "Calendar";
  /** That app as connections name it (a Google app). */
  googleApp: "gmail" | "calendar";
  /** What starts a run, in an admin's words. */
  words: string;
  /** The item a run starts on, as a step's words name it: "message" or "invite". */
  item: "message" | "invite";
  /** The facts a check may test, as `{ from: "trigger.<name>" }`. */
  facts: readonly ConditionField[];
  /** The fields a tool's input may read, as `{ from: "trigger.<name>" }`. */
  fields: readonly string[];
  /** What a draft may read as context: `trigger.message`, say. */
  context: readonly string[];
  /**
   * Whether a run on it can draft a reply or escalate: both act on a Gmail message, its thread
   * and its pending form, which only the Gmail trigger starts a run on.
   */
  repliable: boolean;
};

export const triggers: Readonly<Record<TriggerType, TriggerInfo>> = {
  "gmail.message_received": {
    app: "Gmail",
    googleApp: "gmail",
    words: "When a message arrives in Gmail",
    item: "message",
    facts: [
      { name: "sender", type: "text", label: "The sender's address" },
      { name: "senderDomain", type: "text", label: "The sender's domain" },
      { name: "subject", type: "text", label: "The subject" },
      { name: "hasAttachment", type: "yesNo", label: "Has an attachment" },
      { name: "isReply", type: "yesNo", label: "Is a reply" },
    ],
    fields: ["messageId", "threadId"],
    context: ["trigger.message", "trigger.thread"],
    repliable: true,
  },
  "calendar.invite_received": {
    app: "Calendar",
    googleApp: "calendar",
    words: "When a new invite lands on the calendar",
    item: "invite",
    facts: [
      { name: "organizer", type: "text", label: "The organizer's address" },
      { name: "organizerDomain", type: "text", label: "The organizer's domain" },
      { name: "title", type: "text", label: "The event's title" },
    ],
    fields: ["eventId"],
    context: [],
    repliable: false,
  },
};

/** Each trigger's facts, by its type; a check names one as `{ from: "trigger.<name>" }`. */
export const triggerFacts: Readonly<Record<TriggerType, readonly ConditionField[]>> = {
  "gmail.message_received": triggers["gmail.message_received"].facts,
  "calendar.invite_received": triggers["calendar.invite_received"].facts,
};

/** A trigger of `type` with its defaults, as the editor sets it when the admin picks one. */
export function defaultTrigger(type: TriggerType): Spec["trigger"] {
  return type === "gmail.message_received" ? { type, labelIds: ["INBOX"] } : { type };
}
