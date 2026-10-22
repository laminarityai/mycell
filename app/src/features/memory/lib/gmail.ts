// Reading one Gmail message to learn from, through the Nango proxy. What it returns holds the
// message's text: in memory only, never stored, returned from a step or put in an error
// (invariant 8). Only its pointers, item key and the addresses on it are stored.
import { GMAIL, headerValues, messageBody, messageSchema } from "@/features/connections/gmail";
import { proxyGet } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import { emailAddressesIn } from "@/lib/email-addresses";
import type { SourceItem } from "./source-item";

// How much of a body the models read: enough for a business email, short of a long thread's
// quoted history.
const MAX_BODY_CHARS = 12_000;

/** About the most text of one email a model reads: its body, and its headers. */
export const MAX_TEXT_CHARS = MAX_BODY_CHARS + 1_000;

// What reading an email reads of the message.
const emailSchema = messageSchema.pick({
  id: true,
  labelIds: true,
  internalDate: true,
  payload: true,
});

/**
 * One email, read to learn from. Its item key is the Message-ID header, lowercased without its
 * angle brackets: the same in every copy. `addresses` are everyone on it (From, To, Cc, and Bcc
 * as this copy shows it), `senders` its From, and `text` its headers and body.
 *
 * Its access list is only what Mycel saw (ADR-0023), never what its headers claim, since anyone
 * can write any address there: an outsider who mails one member and puts all@ on Cc reached
 * only that member. So it's the mailbox holding the copy and, for a copy that mailbox sent
 * (Gmail's SENT label, which only the mailbox's owner can cause), everyone on it too: the
 * company's own sender chose them. Anyone else on an inbound email counts once their own
 * connected mailbox holds a copy (the visibility rule for held copies), and a company-wide list
 * once a mailbox at its address holds one. A sent copy is also what makes an email come from
 * inside the company.
 */
export type EmailToLearn = SourceItem & { kind: "email"; labelIds: string[] };

const SHOWN_HEADERS = ["From", "To", "Cc", "Date", "Subject"];

/**
 * The message, or null when Gmail no longer has it or it's in the trash: deleting a message in
 * Gmail moves it there, and memory forgets what a deleted message taught.
 */
export async function readEmail(
  ctx: Ctx,
  connection: { id: string; accountEmail: string },
  messageId: string,
): Promise<EmailToLearn | null> {
  const connectionId = connection.id;
  const message = await proxyGet(
    ctx,
    connectionId,
    `${GMAIL}/messages/${encodeURIComponent(messageId)}?format=full`,
    emailSchema,
  );
  if (message === null || message.labelIds.includes("TRASH")) return null;
  const header = (name: string) => headerValues(message.payload?.headers, name).join(", ");
  const messageIdHeader = header("Message-ID").trim();
  const shown = SHOWN_HEADERS.flatMap((name) => {
    const value = header(name);
    return value === "" ? [] : [`${name}: ${value}`];
  });
  const body = messageBody(message.payload).text.slice(0, MAX_BODY_CHARS);
  const addresses = [
    ...new Set(["From", "To", "Cc", "Bcc"].flatMap((name) => emailAddressesIn(header(name)))),
  ];
  const sent = message.labelIds.includes("SENT");
  const holder = connection.accountEmail.trim().toLowerCase();
  const confirmed = [...new Set([holder, ...(sent ? addresses : [])])];
  return {
    kind: "email",
    sourceRef: message.id,
    // With no Message-ID, the copy is its own item: Gmail's message IDs are only unique within
    // one mailbox, and a shared item key makes a copy visible to its holder.
    itemKey:
      messageIdHeader === ""
        ? `gmail:${connectionId}:${message.id}`
        : messageIdHeader.replace(/^<|>$/g, "").toLowerCase(),
    occurredAt: new Date(Number(message.internalDate)),
    labelIds: message.labelIds,
    access: confirmed.map((value) => ({ kind: "address", value })),
    addresses,
    fromInside: sent,
    senders: emailAddressesIn(header("From")),
    text: `${shown.join("\n")}\n\n${body}`,
  };
}
