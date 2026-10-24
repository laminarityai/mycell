// One item read from its app to learn from: an email, a Drive doc or a Calendar invite. Its text is held in memory
// only, never stored, returned from a step or put in an error (invariant 8); only its pointers,
// item key and access list are stored.

/** One principal on an item's access list (ADR-0023): an address, a domain, or anyone. */
export type AccessEntry =
  | { kind: "address"; value: string }
  | { kind: "domain"; value: string }
  | { kind: "anyone"; value: "" };

export type SourceItem = {
  kind: "email" | "document" | "invite";
  // How the item is re-fetched: a Gmail message ID, a Drive file's `<file ID>@<modified time>`, or
  // a Calendar event's `<event ID>@<sequence>`.
  sourceRef: string;
  // The same for every copy of the item: an email's Message-ID, a Drive file's ID, or an event's
  // iCalUID.
  itemKey: string;
  occurredAt: Date;
  // Who Mycel saw may see it, lowercased (its confirmed access list): a doc's sharing list; the
  // mailbox holding an email, and everyone on an email that mailbox sent; the calendar holding an
  // invite, and everyone on an invite that calendar's account organised.
  access: AccessEntry[];
  // The addresses the item shows besides those in its text, lowercased: everyone on an email,
  // as its headers say; an invite's organizer and guests. Those not in `access` are kept
  // unconfirmed, for exclusions only.
  addresses: string[];
  // Whether it came from inside the company: an email the mailbox holding it sent, a doc a
  // colleague owns, or an invite the calendar's account organised.
  fromInside: boolean;
  // Who sent it, lowercased: an email's From, an invite's organizer. None for a doc.
  senders: string[];
  // As a model reads it. In memory only.
  text: string;
  // Where its app files it, for exclusions: an email's label IDs, a doc's parent folder IDs.
  labelIds?: string[];
  parentIds?: string[];
};

/**
 * An item's access list as rows: its confirmed entries, and the other addresses it shows, kept
 * unconfirmed for exclusions only, since Mycel didn't see that they reach anyone.
 */
export function accessRows(item: Pick<SourceItem, "access" | "addresses">): {
  kind: AccessEntry["kind"];
  value: string;
  confirmed: boolean;
}[] {
  const confirmed = new Set(item.access.map((entry) => `${entry.kind}:${entry.value}`));
  return [
    ...item.access.map(({ kind, value }) => ({ kind, value, confirmed: true })),
    ...item.addresses
      .filter((value) => !confirmed.has(`address:${value}`))
      .map((value) => ({ kind: "address" as const, value, confirmed: false })),
  ];
}
