// The model calls learning makes (ADR-0022): `classify` decides whether an item (an email, a doc
// or a Calendar invite) is business, and a structured-output call on `fast` extracts objects and short facts
// from it. What the model answers is then checked against the item itself, deterministically:
// an object's key must appear in it, each fact must quote it, a fact that copies a long run of
// it word for word is dropped, and so is a personal fact about someone outside the company. The quotes are checked here and never stored (invariant 8).
import { z } from "zod";
import { callModel, classify } from "@/features/models/server";
import type { Ctx } from "@/lib/ctx";
import { emailAddressesIn } from "@/lib/email-addresses";
import type { PromptText } from "@/lib/prompts";
import { OBJECT_KINDS, type ObjectKeyKind, type ObjectKind } from "../types";
import { MEMORY_USAGE } from "./budget";
import { extractPrompts } from "./prompts";
import type { SourceItem } from "./source-item";

const BUSINESS = "business";

// What `classify` asks of each kind of item, and the labels it chooses from.
const BUSINESS_QUESTIONS: Record<SourceItem["kind"], { question: PromptText; labels: string[] }> = {
  email: {
    question: extractPrompts.emailQuestion(),
    labels: [BUSINESS, "newsletter", "marketing", "notification", "personal"],
  },
  document: {
    question: extractPrompts.documentQuestion(),
    labels: [BUSINESS, "personal", "template", "other"],
  },
  invite: {
    question: extractPrompts.inviteQuestion(),
    labels: [BUSINESS, "personal", "other"],
  },
};

// A statement longer than this isn't a short fact: it's dropped rather than stored.
const MAX_STATEMENT_CHARS = 280;

// A statement holding this many words in a row as the item has them copies the item rather
// than stating a fact about it, and is dropped (invariant 8: memory keeps no source text).
const MAX_COPIED_WORDS = 8;

// Webmail domains: an address there says nothing about a company.
const WEBMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

/**
 * Whether the item is business: an email rather than a newsletter, marketing, a notification
 * or personal mail; a doc about the company's work rather than a personal one or a template; a
 * meeting about the company's work rather than a personal appointment.
 */
export async function isBusiness(ctx: Ctx, item: SourceItem): Promise<boolean> {
  const { label } = await classify(ctx, {
    ...BUSINESS_QUESTIONS[item.kind],
    state: item.text,
    ...MEMORY_USAGE,
  });
  return label === BUSINESS;
}

const extractionSchema = z.object({
  objects: z.array(
    z.object({
      ref: z.string().describe(extractPrompts.objectRef()),
      kind: z.enum(OBJECT_KINDS),
      name: z.string(),
      email: z.string().nullable().describe(extractPrompts.objectEmail()),
      domain: z.string().nullable().describe(extractPrompts.objectDomain()),
    }),
  ),
  facts: z.array(
    z.object({
      about: z.string().describe(extractPrompts.factAbout()),
      statement: z.string().describe(extractPrompts.factStatement()),
      evidence: z.string().describe(extractPrompts.factEvidence()),
      predicate: z.string().nullable().describe(extractPrompts.factPredicate()),
      value: z.string().nullable(),
      object: z.string().nullable().describe(extractPrompts.factObject()),
      validFrom: z.string().nullable().describe(extractPrompts.factValidFrom()),
      kind: z.enum(["work", "personal"]),
    }),
  ),
});
type Extraction = z.infer<typeof extractionSchema>;

/** An object an item states, with the exact keys it can be matched on. */
export type ExtractedObject = {
  ref: string;
  kind: ObjectKind;
  name: string;
  keys: { kind: ObjectKeyKind; value: string }[];
};

/** A fact an item states, about one of its objects (`about`, a ref). */
export type ExtractedFact = {
  about: string;
  statement: string;
  predicate: string | null;
  value: string | null;
  object: string | null;
  validFrom: Date | null;
};

export type Extracted = { objects: ExtractedObject[]; facts: ExtractedFact[] };

/** The objects and facts the item states, checked against it. `domain` is the company's own. */
export async function extract(ctx: Ctx, item: SourceItem, domain: string): Promise<Extracted> {
  const { output } = await callModel(ctx, "fast", {
    system: extractPrompts.system({ kind: item.kind, domain }),
    prompt: extractPrompts.prompt({ kind: item.kind, text: item.text }),
    schema: extractionSchema,
    ...MEMORY_USAGE,
  });
  return grounded(output, item, domain);
}

// Keeps what the item itself supports, and the objects a kept fact needs.
function grounded(extraction: Extraction, item: SourceItem, domain: string): Extracted {
  const text = normalized(item.text);
  const runs = wordRuns(item.text);
  const addresses = new Set([...item.addresses, ...emailAddressesIn(item.text)]);
  const objects = new Map<string, ExtractedObject & { insider: boolean }>();
  for (const object of extraction.objects) {
    const keys = keysOf(object, addresses, text);
    if (keys === null || objects.has(object.ref) || object.name.trim() === "") continue;
    const address = keys.find((key) => key.kind === "email")?.value;
    objects.set(object.ref, {
      ref: object.ref,
      kind: object.kind,
      name: object.name.trim(),
      keys,
      insider: object.kind === "person" && address?.endsWith(`@${domain}`) === true,
    });
  }
  const facts = extraction.facts.flatMap((fact): ExtractedFact[] => {
    const subject = objects.get(fact.about);
    const statement = fact.statement.trim();
    const evidence = normalized(fact.evidence);
    if (subject === undefined || statement === "" || statement.length > MAX_STATEMENT_CHARS) {
      return [];
    }
    if (evidence === "" || !text.includes(evidence)) return [];
    if ([...wordRuns(statement)].some((run) => runs.has(run))) return [];
    if (fact.kind === "personal" && !subject.insider) return [];
    const linked = fact.object === null ? undefined : objects.get(fact.object);
    return [
      {
        about: fact.about,
        statement,
        predicate: fact.predicate?.trim() || null,
        value: fact.value?.trim() || null,
        object: linked === undefined || linked.ref === subject.ref ? null : linked.ref,
        validFrom: dateOf(fact.validFrom),
      },
    ];
  });
  const used = new Set(facts.flatMap((fact) => [fact.about, fact.object ?? fact.about]));
  return {
    objects: [...objects.values()]
      .filter((object) => used.has(object.ref))
      .map(({ ref, kind, name, keys }) => ({ ref, kind, name, keys })),
    facts,
  };
}

// An object's keys, or null when it names one the item doesn't show: it isn't what the item
// states.
function keysOf(
  object: Extraction["objects"][number],
  addresses: Set<string>,
  text: string,
): ExtractedObject["keys"] | null {
  const keys: ExtractedObject["keys"] = [];
  const email = object.email?.trim().toLowerCase();
  if (email) {
    if (!addresses.has(email)) return null;
    keys.push({ kind: "email", value: email });
  }
  const domain = object.domain
    ?.trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (domain) {
    if (!text.includes(domain)) return null;
    if (!WEBMAIL_DOMAINS.has(domain)) keys.push({ kind: "domain", value: domain });
  }
  return keys;
}

// Every run of MAX_COPIED_WORDS words in a row in the text: words as spaces separate them,
// lowercased, without the punctuation around them.
function wordRuns(text: string): Set<string> {
  const words = normalized(text)
    .split(" ")
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word !== "");
  const runs = new Set<string>();
  for (let i = 0; i + MAX_COPIED_WORDS <= words.length; i += 1) {
    runs.add(words.slice(i, i + MAX_COPIED_WORDS).join(" "));
  }
  return runs;
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

function dateOf(value: string | null): Date | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
