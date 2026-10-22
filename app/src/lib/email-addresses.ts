// Finding email addresses in text, one way everywhere: in a message's headers and body, and in
// what someone searches memory for. Exact patterns only, no fuzzy matching.

// A local part may hold an apostrophe (o'brien@…) but not start with one, so a quoted address
// ('ada@…') reads without the quote. A TLD of letters only, so Content-IDs like
// image001.png@01D9A1B2.C3D4E5F0 don't match.
const EMAIL_ADDRESS = /[a-z0-9._%+-][a-z0-9._%+'-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;

/** Every email address in `text`, lowercased, without duplicates, in order of appearance. */
export function emailAddressesIn(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(EMAIL_ADDRESS), ([match]) => match.toLowerCase()))];
}
