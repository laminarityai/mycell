// Turns one Gmail message into one event. The body is decoded here, in memory, only to find
// object refs in it; the subject, body, snippet and file names never leave this module.
import type { NormalizedEvent } from "../connector";
import { driveFileIdsIn, emailAddressesIn } from "../object-refs";
import type { Message, MessagePart } from "./api";

const ADDRESS_HEADERS = ["from", "to", "cc", "bcc"] as const;

export function normalizeMessage(message: Message): NormalizedEvent {
  const parts = flatten(message.payload);
  const addresses = headerAddresses(message.payload);
  const actor = addresses.from.at(0) ?? null;
  const recipients = [...addresses.to, ...addresses.cc, ...addresses.bcc];
  const labelIds = message.labelIds ?? [];
  const sent = labelIds.includes("SENT");
  const text = bodyText(parts);
  const attachments = parts.filter(isAttachment).map((part) => ({
    mimeType: part.mimeType ?? "application/octet-stream",
    size: part.body?.size ?? 0,
    // Gmail's parts name no Drive file: a file attached from Drive arrives as a link in the
    // body, which the drive_file refs below pick up.
    driveFileId: null,
  }));
  const emails = new Set([...addresses.from, ...recipients, ...emailAddressesIn(text)]);
  return {
    sourceRef: message.id,
    type: sent ? "email.sent" : "email.received",
    occurredAt: new Date(Number(message.internalDate)),
    actor,
    counterparties: [...new Set(recipients)].filter((address) => address !== actor),
    direction: sent ? "outbound" : "inbound",
    threadId: message.threadId ?? null,
    attachments,
    labelIds,
    mimeType: null,
    objectRefs: [
      ...[...emails].map((key) => ({ kind: "email" as const, key })),
      ...driveFileIdsIn(text).map((key) => ({ kind: "drive_file" as const, key })),
    ],
  };
}

function headerAddresses(payload: MessagePart | undefined) {
  const found = { from: [], to: [], cc: [], bcc: [] } as Record<
    (typeof ADDRESS_HEADERS)[number],
    string[]
  >;
  for (const header of payload?.headers ?? []) {
    const name = header.name.toLowerCase();
    const key = ADDRESS_HEADERS.find((candidate) => candidate === name);
    if (key !== undefined) found[key].push(...emailAddressesIn(header.value));
  }
  return found;
}

// Every part, depth first, the payload included.
function flatten(part: MessagePart | undefined): MessagePart[] {
  if (part === undefined) return [];
  return [part, ...(part.parts ?? []).flatMap(flatten)];
}

function isAttachment(part: MessagePart): boolean {
  return (part.filename ?? "") !== "";
}

// The message's text: its text/plain parts, or failing those its text/html parts stripped of
// tags (keeping link targets, which carry Drive file IDs and mailto addresses).
function bodyText(parts: MessagePart[]): string {
  const inline = parts.filter((part) => !isAttachment(part) && part.body?.data !== undefined);
  const plain = inline.filter((part) => part.mimeType === "text/plain");
  if (plain.length > 0) return plain.map(decode).join("\n");
  return inline
    .filter((part) => part.mimeType === "text/html")
    .map((part) => htmlToText(decode(part)))
    .join("\n");
}

function decode(part: MessagePart): string {
  return Buffer.from(part.body?.data ?? "", "base64url").toString("utf8");
}

function htmlToText(html: string): string {
  const links = Array.from(html.matchAll(/href\s*=\s*["']([^"']*)["']/gi), (match) => match[1]);
  const text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  return decodeEntities([text, ...links].join("\n"));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(lt|gt|quot|apos|nbsp);/g, (_, name: string) => ENTITIES[name] ?? " ")
    .replace(/&amp;/g, "&");
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
