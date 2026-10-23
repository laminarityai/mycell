// Deterministic object refs (ADR-0008): exact email addresses and Drive file IDs, found by
// pattern in header values and in decoded text. No fuzzy matching and no model.
import { unique } from "@/lib/utils";
import type { ObjectRefKind } from "../types";

const DRIVE_ID = "([a-zA-Z0-9_-]{10,})";
const DRIVE_LINKS = [
  new RegExp(
    String.raw`docs\.google\.com/(?:document|spreadsheets|presentation)/(?:u/\d+/)?d/` + DRIVE_ID,
    "g",
  ),
  new RegExp(String.raw`drive\.google\.com/(?:u/\d+/)?file/d/` + DRIVE_ID, "g"),
  new RegExp(String.raw`drive\.google\.com/open\?(?:[^\s"'<>]*&)?id=` + DRIVE_ID, "g"),
];

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
