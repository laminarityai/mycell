// One item read from its app to learn from: an email or a Drive doc. Its text is held in memory
// only, never stored, returned from a step or put in an error (invariant 8); only its pointers,
// item key and access list are stored.

/** One principal on an item's access list (ADR-0023): an address, a domain, or anyone. */
export type AccessEntry =
  | { kind: "address"; value: string }
  | { kind: "domain"; value: string }
  | { kind: "anyone"; value: "" };

export type SourceItem = {
  kind: "email" | "document";
  // How the item is re-fetched: a Gmail message ID, or a Drive file's `<file ID>@<modified time>`.
  sourceRef: string;
  // The same for every copy of the item: an email's Message-ID, or a Drive file's ID.
  itemKey: string;
  occurredAt: Date;
  // Who the app says may see it, lowercased: everyone on an email, a doc's sharing list.
  access: AccessEntry[];
  // The addresses the item shows besides those in its text, lowercased: everyone on an email.
  addresses: string[];
  // Who sent it, lowercased: an email's From. None for a doc.
  senders: string[];
  // As a model reads it. In memory only.
  text: string;
  // Where its app files it, for exclusions: an email's label IDs, a doc's parent folder IDs.
  labelIds?: string[];
  parentIds?: string[];
};
