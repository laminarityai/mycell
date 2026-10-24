// A conversation's citations: the facts its tools read, each with its sources in the person's
// view now (memory's `citeFacts`, never what the fact says), linked to where they can open them.
// Only facts the conversation's own tools returned are cited, so a model that guessed or was
// told another fact's ID cites nothing. A copy in the person's own mailbox opens there by its
// Gmail ID; any other copy (a colleague's, an org inbox's) is reached by the email's Message-ID
// (`rfc822msgid:`), never another mailbox's own ID, in the person's own Google account. An
// invite opens in the person's own calendar when it's their copy; another calendar's has no link.
import { z } from "zod";
import { connectionOwners } from "@/features/connections/server";
import { citeFacts } from "@/features/memory/server";
import type { FactCitation, FactSource } from "@/features/memory/types";
import { findUser } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import type { AgentMessage, Citation, CitedSource } from "../types";

// What a memory tool stores of its result (`memory-tools.ts`): the fact IDs are what's cited.
const readIds = z.object({ factIds: z.array(z.string()) });

/** The IDs of every fact the messages' tools read, in the order they read them. */
export function readFactIds(messages: Pick<AgentMessage, "parts">[]): string[] {
  const ids = messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (part.type !== "tool" || part.isError) return [];
      const parsed = readIds.safeParse(part.output);
      return parsed.success ? parsed.data.factIds : [];
    }),
  );
  return [...new Set(ids)];
}

export async function citationsOf(ctx: Ctx, messages: AgentMessage[]): Promise<Citation[]> {
  const ids = readFactIds(messages);
  if (ids.length === 0) return [];
  const [cited, owners, me] = await Promise.all([
    citeFacts(ctx, ids),
    connectionOwners(ctx),
    findUser(ctx, ctx.userId),
  ]);
  // The person's own mailboxes and Drives, by connection, with the account each reaches.
  const own = new Map(
    owners.flatMap((owner) =>
      owner.kind === "member" &&
      !owner.owner.removed &&
      owner.owner.userId === ctx.userId &&
      owner.accountEmail !== null
        ? [[owner.id, owner.accountEmail] as const]
        : [],
    ),
  );
  const account = me?.email ?? null;
  return cited.map((fact) => citation(fact, own, account));
}

function citation(fact: FactCitation, own: Map<string, string>, account: string | null): Citation {
  // One source per item, the person's own copy first.
  const byItem = new Map<string, CitedSource>();
  for (const source of fact.sources) {
    const cited = citedSource(source, own.get(source.connectionId), account);
    const seen = byItem.get(cited.key);
    if (seen === undefined || (!seen.yours && cited.yours)) byItem.set(cited.key, cited);
  }
  return {
    factId: fact.id,
    disputed: fact.conflictsWith !== null,
    outsideOnly: fact.outsideOnly,
    told: fact.told,
    sources: [...byItem.values()],
  };
}

function citedSource(
  source: FactSource,
  ownAccount: string | undefined,
  account: string | null,
): CitedSource {
  const key = `${source.app}:${source.itemKey}`;
  const yours = ownAccount !== undefined;
  if (source.app === "drive") {
    // Memory reads only Google Docs; the item key is the file's ID.
    const href = `https://docs.google.com/document/d/${encodeURIComponent(source.itemKey)}/edit`;
    return { key, kind: "doc", occurredAt: source.occurredAt, href, yours };
  }
  if (source.app === "calendar") {
    return { key, kind: "invite", occurredAt: source.occurredAt, href: calendarLink(), yours };
  }
  return { key, kind: "email", occurredAt: source.occurredAt, href: gmailLink(), yours };

  // Calendar's own event link: `eid` is the event's ID and its calendar's, base64 with no
  // padding. The source ref is `<event ID>@<sequence>`, and a connection's calendar is its
  // account's primary one.
  function calendarLink(): string | null {
    if (ownAccount === undefined) return null;
    const eventId = source.sourceRef.slice(0, source.sourceRef.lastIndexOf("@"));
    const eid = Buffer.from(`${eventId} ${ownAccount}`).toString("base64").replace(/=+$/, "");
    return `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(eid)}&authuser=${encodeURIComponent(ownAccount)}`;
  }

  function gmailLink(): string | null {
    if (ownAccount !== undefined) {
      return `https://mail.google.com/mail/?authuser=${encodeURIComponent(ownAccount)}#all/${encodeURIComponent(source.sourceRef)}`;
    }
    // An email with no Message-ID is its own item (`gmail:<connection>:<id>`): nothing else
    // finds it.
    if (source.itemKey.startsWith("gmail:")) return null;
    const user = account === null ? "" : `?authuser=${encodeURIComponent(account)}`;
    return `https://mail.google.com/mail/${user}#search/${encodeURIComponent(`rfc822msgid:${source.itemKey}`)}`;
  }
}
