// The fixed rule that sets a custom action's risk level from the call it makes (invariant 4,
// ADR-0018). It is the only thing that sets one: a level the builder chat proposes never reaches
// it. A read is `read`; any other call is `external_send`, so it waits for a person every time it
// runs, since no rule can tell a record change from words said in someone's name (ADR-0019).
// Deletes, delete-like names and writes in accounting or payments apps are refused.
// Pure: no IO, no ctx.
import type { CustomCall, RiskLevel } from "./types";

export type CustomRisk =
  { ok: true; risk: Extract<RiskLevel, "read" | "external_send"> } | { ok: false; reason: string };

/** The words a refused path, body field or operation name says, matched at each word's start. */
const REFUSED_WORDS = [
  "delete",
  "remove",
  "void",
  "refund",
  "cancel",
  "archive",
  "purge",
  "trash",
  "move",
];

/** The risk level of `call` in an app, or why the call is refused. */
export function customActionRisk(
  call: CustomCall,
  app: { accountingOrPayments: boolean },
): CustomRisk {
  let reads: boolean;
  let names: string[];
  if ("graphql" in call) {
    const operation = graphqlOperation(call.graphql);
    if (!operation.ok) return operation;
    reads = operation.type === "query";
    names = [call.path, ...operation.names];
  } else {
    if (call.method === "DELETE") return { ok: false, reason: "A custom action can't delete." };
    reads = call.method === "GET";
    // A body field can say it too: Drive's `trashed`, an event's `isCancelled`.
    names = [call.path, ...Object.keys(call.body ?? {})];
  }
  const refused = names
    .flatMap(words)
    .find((word) => REFUSED_WORDS.some((w) => word.startsWith(w)));
  if (refused !== undefined) {
    return {
      ok: false,
      reason: `A custom action can't delete, remove, void, refund, cancel, archive, purge, trash or move, and "${refused}" says it might.`,
    };
  }
  if (!reads && app.accountingOrPayments) {
    return { ok: false, reason: "A custom action can only read in an accounting or payments app." };
  }
  return { ok: true, risk: reads ? "read" : "external_send" };
}

// A name's words, lowercased: split at anything but a letter or digit, and where camelCase turns.
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
}

type Operation =
  { ok: true; type: "query" | "mutation"; names: string[] } | { ok: false; reason: string };

type Definition = { type: string; header: string[]; root: string[]; spread: boolean };

/**
 * The one operation a GraphQL document holds, by its type, with the names that say what it
 * does: for a mutation, its own name and its root fields' (aliases included); for a query none,
 * since a query only reads, whatever its fields are called (`cancelledAt`). A document is its
 * top-level definitions: fragments, and operations, each `query`, `mutation` or `subscription`
 * with an optional name, or a bare selection set, which is a query. A mutation that spreads a
 * fragment at its root has every name in the document checked instead.
 */
function graphqlOperation(document: string): Operation {
  const tokens = tokenize(document);
  if (tokens === undefined) return refusedDocument("its brackets don't match");
  const definitions = topLevel(tokens);
  const executable = definitions.filter(({ type }) => type !== "fragment");
  if (executable.length !== 1) return refusedDocument("it must hold exactly one operation");
  const [operation] = executable;
  const { type } = operation;
  if (type !== "query" && type !== "mutation") {
    return refusedDocument("only a query or a mutation can be a custom action");
  }
  if (type === "query") return { ok: true, type, names: [] };
  const names = operation.spread
    ? tokens.filter((token) => /^[A-Za-z_]/.test(token))
    : [...operation.header.slice(1), ...operation.root];
  return { ok: true, type, names };
}

// Each top-level definition: what comes before its selection set (its type and name), the
// fields at the root of its selection set, and whether that root spreads a fragment.
function topLevel(tokens: readonly string[]): Definition[] {
  const definitions: Definition[] = [];
  let header: string[] = [];
  let depth = 0;
  let parens = 0;
  for (const token of tokens) {
    const current = definitions.at(-1);
    if (token === "(" || token === ")") {
      parens += token === "(" ? 1 : -1;
    } else if (parens > 0) {
      // An argument or a variable's definition: what it's called says nothing of what it does.
    } else if (token === "{") {
      if (depth === 0) {
        definitions.push({ type: header.at(0) ?? "query", header, root: [], spread: false });
        header = [];
      }
      depth += 1;
    } else if (token === "}") {
      depth -= 1;
    } else if (depth === 0) {
      header.push(token);
    } else if (depth === 1 && current !== undefined) {
      if (token === "...") current.spread = true;
      else current.root.push(token);
    }
  }
  return definitions;
}

function refusedDocument(why: string): Operation {
  return { ok: false, reason: `The GraphQL operation can't be used: ${why}.` };
}

// The document's names, brackets and spreads, without comments, strings, variables or other
// punctuation. Undefined when its brackets don't nest.
function tokenize(document: string): string[] | undefined {
  const stripped = document
    .replace(/"""[\s\S]*?"""/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, " ")
    .replace(/#[^\n]*/g, " ")
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, " ");
  const tokens = stripped.match(/[A-Za-z_][A-Za-z0-9_]*|\.\.\.|[{}()]/g) ?? [];
  const open: string[] = [];
  for (const token of tokens) {
    if (token === "{" || token === "(") open.push(token);
    else if (token === "}" && open.pop() !== "{") return undefined;
    else if (token === ")" && open.pop() !== "(") return undefined;
  }
  return open.length === 0 ? tokens : undefined;
}
