// Deterministic object refs (ADR-0008): exact email addresses and Drive file IDs, found by
// pattern in header values and in decoded text. No fuzzy matching and no model.
import type { ObjectRefKind } from "../types";

// A TLD of letters only, so Content-IDs like image001.png@01D9A1B2.C3D4E5F0 don't match.
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;

const DRIVE_ID = "([a-zA-Z0-9_-]{10,})";
const DRIVE_LINKS = [
  new RegExp(
    String.raw`docs\.google\.com/(?:document|spreadsheets|presentation)/(?:u/\d+/)?d/` + DRIVE_ID,
    "g",
  ),
  new RegExp(String.raw`drive\.google\.com/(?:u/\d+/)?file/d/` + DRIVE_ID, "g"),
  new RegExp(String.raw`drive\.google\.com/open\?(?:[^\s"'<>]*&)?id=` + DRIVE_ID, "g"),
];

/** Every email address in `text`, lowercased, without duplicates, in order of appearance. */
export function emailAddressesIn(text: string): string[] {
  return unique(Array.from(text.matchAll(EMAIL), ([match]) => match.toLowerCase()));
}

/** Every Drive file ID linked from `text` (Docs, Sheets, Slides and Drive links). */
export function driveFileIdsIn(text: string): string[] {
  return unique(DRIVE_LINKS.flatMap((pattern) => Array.from(text.matchAll(pattern), idOf)));
}

/** The exact key an object of this kind is matched on. */
export function normalizeKey(kind: ObjectRefKind, key: string): string {
  return kind === "email" ? key.trim().toLowerCase() : key.trim();
}

// Each Drive link pattern captures the file ID as its first group.
function idOf(match: RegExpExecArray): string {
  return match[1];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
