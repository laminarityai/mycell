// Google Docs' API as Mycel reaches it through the Nango proxy, and where a person opens a
// document. Pure: no IO.

/** Where every Docs API path for the connection's documents starts. */
export const DOCUMENTS = "/v1/documents";

/** A document's address in Docs, where a person opens it. */
export function documentLink(documentId: string): string {
  return `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`;
}
