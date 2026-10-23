// Turns one Gmail message into one event. The body is decoded here, in memory, only to find
// object refs in it; the subject, body, snippet and file names never leave this module.
import {
  flattenParts,
  headerValues,
  isAttachment,
  messageBody,
  type Message,
} from "@/features/connections/gmail";
import { emailAddressesIn } from "@/lib/email-addresses";
import type { NormalizedEvent } from "../connector";
import { driveFileIdsIn } from "../object-refs";

export function normalizeMessage(message: Message): NormalizedEvent {
  const addresses = (name: string) =>
    headerValues(message.payload?.headers, name).flatMap(emailAddressesIn);
  const from = addresses("From");
  const actor = from.at(0) ?? null;
  const recipients = [...addresses("To"), ...addresses("Cc"), ...addresses("Bcc")];
  const labelIds = message.labelIds;
  const sent = labelIds.includes("SENT");
  // The body's text, and failing a plain-text part the HTML's link targets too.
  const body = messageBody(message.payload);
  const text = [body.text, ...body.links].join("\n");
  const attachments = flattenParts(message.payload)
    .filter(isAttachment)
    .map((part) => ({
      mimeType: part.mimeType ?? "application/octet-stream",
      size: part.body?.size ?? 0,
      // Gmail's parts name no Drive file: a file attached from Drive arrives as a link in the
      // body, which the drive_file refs below pick up.
      driveFileId: null,
    }));
  const emails = new Set([...from, ...recipients, ...emailAddressesIn(text)]);
  return {
    sourceRef: message.id,
    type: sent ? "email.sent" : "email.received",
    occurredAt: new Date(Number(message.internalDate)),
    actor,
    counterparties: [...new Set(recipients)].filter((address) => address !== actor),
    direction: sent ? "outbound" : "inbound",
    threadId: message.threadId,
    attachments,
    labelIds,
    mimeType: null,
    objectRefs: [
      ...[...emails].map((key) => ({ kind: "email" as const, key })),
      ...driveFileIdsIn(text).map((key) => ({ kind: "drive_file" as const, key })),
    ],
  };
}
