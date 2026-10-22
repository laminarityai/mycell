// The fixed rule that sets a custom action's risk level from the call it makes (invariant 4,
// ADR-0018). It is the only thing that sets one: a level the builder chat proposes never reaches
// it. A read is `read`; any other call is `external_send`, so it waits for a person every time it
// runs, since no rule can tell a record change from words said in someone's name (ADR-0019).
// Deletes, delete-like names and writes in accounting or payments apps are refused.
// Pure: no IO, no ctx.
import type { CustomCall, RiskLevel } from "./types";

export type CustomRisk =
  { ok: true; risk: Extract<RiskLevel, "read" | "external_send"> } | { ok: false; reason: string };

/** The words a refused path or operation name says, matched at the start of each word. */
const REFUSED_WORDS = ["delete", "remove", "void", "refund", "cancel", "archive", "purge"];

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
    names = [call.path];
  }
  const refused = names
    .flatMap(words)
    .find((word) => REFUSED_WORDS.some((w) => word.startsWith(w)));
  if (refused !== undefined) {
    return {
      ok: false,
      reason: `A custom action can't delete, remove, void, refund, cancel, archive or purge, and "${refused}" says it might.`,
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

/**
 * The one operation a GraphQL document holds, by its type, with every name in it (its own, its
 * fields', its arguments'). A document is its top-level definitions: fragments, and operations,
 * each `query`, `mutation` or `subscription` with an optional name, or a bare selection set,
 * which is a query.
 */
function graphqlOperation(document: string): Operation {
  const tokens = tokenize(document);
  if (tokens === undefined) return refusedDocument("its brackets don't match");
  const operations: string[] = [];
  let depth = 0;
  let pending: string | undefined;
  for (const token of tokens) {
    if (token === "{") {
      if (depth === 0) operations.push(pending ?? "query");
      pending = undefined;
      depth += 1;
    } else if (token === "}") {
      depth -= 1;
    } else if (depth === 0 && pending === undefined && /^[A-Za-z_]/.test(token)) {
      pending = token;
    }
  }
  const executable = operations.filter((type) => type !== "fragment");
  if (executable.length !== 1) return refusedDocument("it must hold exactly one operation");
  const type = executable[0];
  if (type !== "query" && type !== "mutation") {
    return refusedDocument("only a query or a mutation can be a custom action");
  }
  return { ok: true, type, names: tokens.filter((token) => /^[A-Za-z_]/.test(token)) };
}

function refusedDocument(why: string): Operation {
  return { ok: false, reason: `The GraphQL operation can't be used: ${why}.` };
}

// The document's names and braces, without comments, strings, variables or other punctuation.
// Undefined when its braces don't balance.
function tokenize(document: string): string[] | undefined {
  const stripped = document
    .replace(/"""[\s\S]*?"""/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, " ")
    .replace(/#[^\n]*/g, " ")
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, " ");
  const tokens = stripped.match(/[A-Za-z_][A-Za-z0-9_]*|[{}]/g) ?? [];
  let depth = 0;
  for (const token of tokens) {
    depth += token === "{" ? 1 : token === "}" ? -1 : 0;
    if (depth < 0) return undefined;
  }
  return depth === 0 ? tokens : undefined;
}
