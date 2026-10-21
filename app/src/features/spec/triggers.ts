// What each trigger declares a condition may test about the event that started a run
// (ADR-0015; a trigger is one of the parts an app plugs in with, ADR-0013). A Gmail message's
// facts are read from the message inside the branch step that tests them, and never stored
// (invariant 8). Pure, so client code may import it.
import type { ConditionField, Spec } from "./types";

export type TriggerType = Spec["trigger"]["type"];

/** Each trigger's facts, by its type; a check names one as `{ from: "trigger.<name>" }`. */
export const triggerFacts: Readonly<Record<TriggerType, readonly ConditionField[]>> = {
  "gmail.message_received": [
    { name: "sender", type: "text", label: "The sender's address" },
    { name: "senderDomain", type: "text", label: "The sender's domain" },
    { name: "subject", type: "text", label: "The subject" },
    { name: "hasAttachment", type: "yesNo", label: "Has an attachment" },
    { name: "isReply", type: "yesNo", label: "Is a reply" },
  ],
};
