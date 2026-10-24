// "Remember this" (M9; ADR-0022, ADR-0023): a person tells Mycel a fact, which becomes a fact
// told by them (`origin = told_by`), seen by them alone. It's about an object they can see, or a
// person or company named by its email address or domain, made when memory has none. Before any
// model reads it, an address on the do-not-learn list refuses it, and the injection screen
// checks the statement. One `fast` call then files it: what kind of statement it is (only work
// facts are kept: an opinion, such as one about a colleague, or what isn't about work is refused)
// and its predicate and value; then its statement is embedded. Every call is charged to the
// agent (purpose `agent`, invariant 7). Only the person's statement is stored, as they told it,
// never anything a source said (invariant 8). The same words the same person already told about
// the same subject are that told fact, with no model call; a newer told fact on the same point
// (subject and predicate) replaces their older one, kept as history (`supersede.ts`).
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { forOrg, type OrgScopedDb } from "@/db/for-org";
import { callModel, embed, screenForInjection } from "@/features/models/server";
import { getWorkspaceDomain } from "@/features/orgs/server";
import { type Ctx, requireRole } from "@/lib/ctx";
import { emailAddressesIn } from "@/lib/email-addresses";
import { InvariantError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  tellFactSchema,
  type ObjectKeyKind,
  type ObjectKind,
  type TellFactInput,
  type TellOutcome,
  type TellRefusal,
} from "../types";
import { forgottenAmong } from "./forget";
import { tellPrompts } from "./prompts";
import { facts, memoryObjects, objectKeys } from "./schema";
import { placeInTimelines } from "./supersede";
import { readingOf, visibleObject } from "./visibility";

const AGENT_USAGE = { purpose: "agent" } as const;

// A teller's timeline holds only their told facts, which have no source records, so placing one
// never asks what's company-wide.
const NO_SOURCES = { lists: [], domain: "" };

const filingSchema = z.object({
  kind: z.enum(["work", "personal", "opinion", "other"]).describe(tellPrompts.kind()),
  predicate: z.string().nullable().describe(tellPrompts.predicate()),
  value: z.string().nullable().describe(tellPrompts.value()),
});

type Key = { kind: ObjectKeyKind; value: string };

/** What a told fact is about: an object memory has, or a new one to make with its key. */
type Subject = { id: string | null; kind: ObjectKind; name: string; keys: Key[] };

export async function tellFact(ctx: Ctx, input: TellFactInput): Promise<TellOutcome> {
  requireRole(ctx, "admin", "member");
  const parsed = tellFactSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Say what to remember, and who or what it's about.");
  }
  const { about, statement } = parsed.data;
  const subject = await subjectOf(ctx, about);

  // The do-not-learn list: the subject's address, and any address the statement names.
  const addresses = [
    ...subject.keys.flatMap((key) => (key.kind === "email" ? [key.value] : [])),
    ...emailAddressesIn(statement.toLowerCase()),
  ];
  if ((await forgottenAmong(ctx, addresses)).size > 0) return refused("forgotten");
  if (subject.id !== null) {
    const same = await sameToldFact(ctx, subject.id, statement);
    if (same !== undefined) return saved(same, statement, { ...subject, id: subject.id });
  }

  // Everything the filing model reads, and the agent's model reads back: who it's about, and
  // the statement.
  const { verdict } = await screenForInjection(ctx, {
    text: [subject.name, ...subject.keys.map((key) => key.value), statement].join("\n"),
    ...AGENT_USAGE,
  });
  if (verdict === "flagged") return refused("flagged");
  if (verdict === "unavailable") return refused("unscreened");
  const domain = (await getWorkspaceDomain(ctx)).toLowerCase();
  const { output: filed } = await callModel(ctx, "fast", {
    system: tellPrompts.system({ domain }),
    prompt: tellPrompts.prompt({
      kind: subject.kind,
      name: subject.name,
      keys: subject.keys.map((key) => `<${key.value}>`).join(" "),
      statement,
    }),
    schema: filingSchema,
    ...AGENT_USAGE,
  });
  if (filed.kind === "opinion" || filed.kind === "other") return refused("not_a_fact");
  if (filed.kind === "personal" && !isColleague(subject, domain)) return refused("personal");
  const embedding = (await embed(ctx, { values: [statement], ...AGENT_USAGE })).output.at(0);
  if (embedding === undefined) throw new InvariantError("An embedding came back empty.");

  const id = randomUUID();
  const subjectId = await forOrg(ctx).transaction(async (tx) => {
    const objectId = subject.id ?? (await makeObject(tx, subject));
    const predicate = filed.predicate?.trim().toLowerCase() || null;
    await tx.insert(facts, {
      id,
      subjectId: objectId,
      statement,
      predicate,
      value: predicate === null ? null : filed.value?.trim() || null,
      objectId: null,
      origin: "told_by",
      toldByUserId: ctx.userId,
      embedding,
    });
    await placeInTimelines(tx, ctx.orgId, NO_SOURCES, [id], new Set([id]));
    return objectId;
  });
  return saved(id, statement, { ...subject, id: subjectId });
}

// The object named: by ID, one the person can see (else NotFoundError, as for any read); by an
// address or domain, the object with that key, or a new one.
async function subjectOf(
  ctx: Ctx,
  about: z.output<typeof tellFactSchema>["about"],
): Promise<Subject> {
  const db = forOrg(ctx);
  if ("objectId" in about) {
    const reading = await readingOf(ctx);
    const object = (
      await db.select(memoryObjects, {
        columns: ["id", "kind", "name"],
        where: and(eq(memoryObjects.id, about.objectId), visibleObject(reading)),
      })
    ).at(0);
    if (object === undefined) throw new NotFoundError("object");
    return { ...object, keys: await keysOf(db, object.id) };
  }
  const key: Key =
    "email" in about
      ? { kind: "email", value: about.email }
      : { kind: "domain", value: about.domain };
  const keyed = await objectWithKey(db, key);
  if (keyed !== undefined) return { ...keyed, keys: await keysOf(db, keyed.id) };
  return {
    id: null,
    kind: key.kind === "email" ? "person" : "company",
    name: about.name ?? key.value,
    keys: [key],
  };
}

async function objectWithKey(db: OrgScopedDb, key: Key) {
  const row = (
    await db.select(objectKeys, {
      columns: ["objectId"],
      where: and(eq(objectKeys.kind, key.kind), eq(objectKeys.value, key.value)),
    })
  ).at(0);
  if (row === undefined) return undefined;
  return (
    await db.select(memoryObjects, {
      columns: ["id", "kind", "name"],
      where: eq(memoryObjects.id, row.objectId),
    })
  ).at(0);
}

async function keysOf(db: OrgScopedDb, objectId: string): Promise<Key[]> {
  return db.select(objectKeys, {
    columns: ["kind", "value"],
    where: eq(objectKeys.objectId, objectId),
    orderBy: [objectKeys.kind, objectKeys.value],
  });
}

// The teller's current told fact about the subject with exactly these words, if any.
async function sameToldFact(ctx: Ctx, subjectId: string, statement: string) {
  const row = (
    await forOrg(ctx).select(facts, {
      columns: ["id"],
      where: and(
        eq(facts.subjectId, subjectId),
        eq(facts.toldByUserId, ctx.userId),
        eq(facts.statement, statement),
        isNull(facts.supersededAt),
        // One they deleted is no longer theirs to find: the same words make a new note.
        isNull(facts.deletedAt),
      ),
      limit: 1,
    })
  ).at(0);
  return row?.id;
}

// A new object with its key, unless one took the key since it was looked up.
async function makeObject(tx: OrgScopedDb, subject: Subject): Promise<string> {
  const key = subject.keys.at(0);
  if (key === undefined) throw new InvariantError("A new object needs its key.");
  const taken = await objectWithKey(tx, key);
  if (taken !== undefined) return taken.id;
  const id = randomUUID();
  await tx.insert(memoryObjects, { id, kind: subject.kind, name: subject.name });
  await tx.insert(objectKeys, { objectId: id, ...key });
  return id;
}

function isColleague(subject: Subject, domain: string): boolean {
  return (
    subject.kind === "person" &&
    subject.keys.some((key) => key.kind === "email" && key.value.endsWith(`@${domain}`))
  );
}

const refused = (reason: TellRefusal): TellOutcome => ({ saved: false, reason });

function saved(
  id: string,
  statement: string,
  subject: { id: string; kind: ObjectKind; name: string },
): TellOutcome {
  return {
    saved: true,
    fact: { id, statement, about: { id: subject.id, kind: subject.kind, name: subject.name } },
  };
}
