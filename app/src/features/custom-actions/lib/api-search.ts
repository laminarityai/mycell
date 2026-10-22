// Searching an operation index by plain words. An operation scores for each word of the search
// its path or operation ID says (3) or, failing that, its summary says (2), plus 1 when it's
// what the operation acts on (its path's last segment, not counting placeholders); the best come
// first, then those matching more words, then the shorter paths, so `/me/messages` comes before
// `/users/{userId}/mailFolders/{mailFolderId}/messages`.
import type { HttpMethod } from "@/features/policy/types";
import type { ApiIndex, ApiOperation } from "./api-index-types";

// Not `me`: it's a path word on Graph (`/me/messages`).
const STOP_WORDS = new Set(
  "a an and are as at be by for from get i in into is it its my of on or our the their to with when what which who".split(
    " ",
  ),
);

/** A text's words for searching: split at non-letters and camelCase, lowercased, singular. */
export function searchWords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((word) => singular(word.toLowerCase()))
    .filter((word) => word !== "" && !STOP_WORDS.has(word));
}

function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** An index made ready to search: each operation with the words it's found by. */
export type SearchableIndex = {
  index: ApiIndex;
  entries: {
    operation: ApiOperation;
    strong: Set<string>;
    summary: Set<string>;
    target: Set<string>;
  }[];
};

export function searchable(index: ApiIndex): SearchableIndex {
  return {
    index,
    entries: index.operations.map((operation) => ({
      operation,
      // A placeholder names an input, not what the operation does.
      strong: new Set(searchWords(`${operation.path.replace(/\{[^{}]*\}/g, " ")} ${operation.id}`)),
      summary: new Set(searchWords(operation.summary)),
      target: new Set(
        searchWords(
          operation.path
            .split("/")
            .filter((segment) => segment !== "" && !segment.includes("{"))
            .at(-1) ?? "",
        ),
      ),
    })),
  };
}

/** The operations best matching `search`, at most `limit`, optionally of one method. */
export function searchOperations(
  { entries }: SearchableIndex,
  search: string,
  options: { method?: HttpMethod; limit: number },
): ApiOperation[] {
  const words = [...new Set(searchWords(search))];
  if (words.length === 0) return [];
  const scored: { operation: ApiOperation; score: number; matched: number }[] = [];
  for (const { operation, strong, summary, target } of entries) {
    if (options.method !== undefined && operation.method !== options.method) continue;
    let score = 0;
    let matched = 0;
    for (const word of words) {
      const points = strong.has(word) ? 3 : summary.has(word) ? 2 : 0;
      score += points + (target.has(word) ? 1 : 0);
      matched += points > 0 ? 1 : 0;
    }
    if (score > 0) scored.push({ operation, score, matched });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.matched - a.matched ||
      a.operation.path.length - b.operation.path.length ||
      a.operation.path.localeCompare(b.operation.path),
  );
  return scored.slice(0, options.limit).map(({ operation }) => operation);
}
