// The fake Gmail's messages: what a test seeds, and the users.messages resources the mailbox
// builds from it (and from its drafts) in the shapes Google documents.
import { randomUUID } from "node:crypto";
import { newDraftIds, type FakeDraft } from "./fake-gmail-writes";

/** A message to seed, described the way a test thinks about it. */
export type FakeMessageInput = {
  from: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  attachments?: { filename: string; mimeType: string; size: number }[];
  // Sent from the mailbox (Gmail's SENT label) rather than received in its inbox.
  sent?: boolean;
  // Gmail's labels for it, when not the inbox's or SENT's defaults (["SPAM"], say).
  labelIds?: string[];
  at: Date;
  threadId?: string;
  // More headers, such as Reply-To or a reply's References.
  headers?: Record<string, string>;
};

export type GmailPart = {
  partId: string;
  mimeType: string;
  filename: string;
  headers: { name: string; value: string }[];
  body: { size: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

/** A users.messages resource, as messages.get returns it with format=full. */
export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string;
  payload: GmailPart;
  sizeEstimate: number;
};

export function messageIdOnly() {
  return { messageId: newDraftIds().messageId };
}

// A draft as Gmail keeps it: a DRAFT message in its thread.
export function draftMessage(draft: FakeDraft, historyId: string): GmailMessage {
  const headers = Object.entries(draft.headers).map(([name, value]) => ({ name, value }));
  return {
    id: draft.messageId,
    threadId: draft.threadId,
    labelIds: ["DRAFT"],
    snippet: draft.text.slice(0, 100),
    historyId,
    internalDate: String(Date.now()),
    payload: { ...textPart("", "text/plain", draft.text), headers },
    sizeEstimate: Buffer.byteLength(draft.text),
  };
}

export function gmailMessage(input: FakeMessageInput, historyId: string): GmailMessage {
  const id = randomUUID().replaceAll("-", "").slice(0, 16);
  const headers = [
    { name: "From", value: input.from },
    ...(input.to ? [{ name: "To", value: input.to.join(", ") }] : []),
    ...(input.cc ? [{ name: "Cc", value: input.cc.join(", ") }] : []),
    ...(input.bcc ? [{ name: "Bcc", value: input.bcc.join(", ") }] : []),
    { name: "Subject", value: input.subject ?? "" },
    { name: "Date", value: input.at.toUTCString() },
    // A test's own Message-ID makes copies of one email in several mailboxes.
    ...(hasHeader(input, "Message-ID")
      ? []
      : [{ name: "Message-ID", value: `<${id}@mail.gmail.com>` }]),
    ...Object.entries(input.headers ?? {}).map(([name, value]) => ({ name, value })),
  ];
  const bodies: GmailPart[] = [
    ...(input.text === undefined ? [] : [textPart("0.0", "text/plain", input.text)]),
    ...(input.html === undefined ? [] : [textPart("0.1", "text/html", input.html)]),
  ];
  const attachments: GmailPart[] = (input.attachments ?? []).map((attachment, i) => ({
    partId: String(i + 1),
    mimeType: attachment.mimeType,
    filename: attachment.filename,
    headers: [
      { name: "Content-Type", value: `${attachment.mimeType}; name="${attachment.filename}"` },
      { name: "Content-Disposition", value: `attachment; filename="${attachment.filename}"` },
    ],
    body: { size: attachment.size, attachmentId: `ANGjdJ_${randomUUID()}` },
  }));
  return {
    id,
    threadId: input.threadId ?? id,
    labelIds:
      input.labelIds ?? (input.sent === true ? ["SENT"] : ["INBOX", "UNREAD", "CATEGORY_PERSONAL"]),
    snippet: (input.text ?? "").slice(0, 100),
    historyId,
    internalDate: String(input.at.getTime()),
    payload: {
      partId: "",
      mimeType: "multipart/mixed",
      filename: "",
      headers,
      body: { size: 0 },
      parts: [
        {
          partId: "0",
          mimeType: "multipart/alternative",
          filename: "",
          headers: [],
          body: { size: 0 },
          parts: bodies,
        },
        ...attachments,
      ],
    },
    sizeEstimate: 1024 + (input.attachments ?? []).reduce((sum, a) => sum + a.size, 0),
  };
}

export function textPart(partId: string, mimeType: string, content: string): GmailPart {
  const data = Buffer.from(content, "utf8").toString("base64url");
  return {
    partId,
    mimeType,
    filename: "",
    headers: [{ name: "Content-Type", value: `${mimeType}; charset="UTF-8"` }],
    body: { size: Buffer.byteLength(content), data },
  };
}

function hasHeader(input: FakeMessageInput, name: string): boolean {
  return Object.keys(input.headers ?? {}).some((key) => key.toLowerCase() === name.toLowerCase());
}
