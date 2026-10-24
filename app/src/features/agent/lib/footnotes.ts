// Reading a reply's footnotes: the model cites each fact as `[fact:ID]` right after the
// sentence that uses it (agent/prompts/instructions.prompt.yml). Pure, for the chat page.
import type { Citation, CitedSource } from "../types";

export type Segment = { kind: "text"; text: string } | { kind: "cite"; factId: string };

const MARKER = /\[fact:([^\]\s]+)\]/g;
// A marker still streaming in, at the very end: hidden until it's whole.
const PARTIAL = /\[(?:f(?:a(?:c(?:t(?::[^\]\s]*)?)?)?)?)?$/;

/** A reply's text split into its words and its fact markers, in order. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const match of text.matchAll(MARKER)) {
    if (match.index > at) out.push({ kind: "text", text: text.slice(at, match.index) });
    out.push({ kind: "cite", factId: match[1] });
    at = match.index + match[0].length;
  }
  const rest = text.slice(at).replace(PARTIAL, "");
  if (rest !== "") out.push({ kind: "text", text: rest });
  return out;
}

/**
 * One reply's numbered sources: each source its cited facts name, numbered by where it's first
 * cited, and for each fact the numbers of its sources. A fact with no citation (deleted since,
 * or one the person can't see) gets none.
 */
export function numberSources(
  texts: string[],
  citations: Map<string, Citation>,
): { sources: CitedSource[]; numbers: Map<string, number[]> } {
  const sources: CitedSource[] = [];
  const numbers = new Map<string, number[]>();
  for (const text of texts) {
    for (const segment of segments(text)) {
      if (segment.kind !== "cite" || numbers.has(segment.factId)) continue;
      const citation = citations.get(segment.factId);
      if (citation === undefined) continue;
      numbers.set(
        segment.factId,
        citation.sources.map((source) => {
          const index = sources.findIndex((other) => other.key === source.key);
          if (index >= 0) return index + 1;
          sources.push(source);
          return sources.length;
        }),
      );
    }
  }
  return { sources, numbers };
}
