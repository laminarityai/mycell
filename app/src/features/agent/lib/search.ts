// Searching a person's Ask Mycel conversations (#180), with no model call: their own
// conversations only, with no admin or system exception, whose title or one message holds every
// word searched. A message is searched by its keyword index (`agent_messages.keywords`), made of
// its text parts alone, the person's words and Mycel's reply: never a tool call, what a tool
// read, or a notice. Each word matches as the start of a word, stemmed in English as memory's
// keyword search is, so "acm" finds Acme as it's typed and "renewal" finds "renews". The hits
// come in the rail's order, most recently active first, each with its best-matching message's
// stretch around the match, all in one query whatever the number of conversations.
import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import type { ConversationHit, MarkedText } from "../types";
import { requirePerson } from "./conversations";
import { agentConversations, agentMessages, TEXT_PARTS } from "./schema";

// The most words of a search that count, and the longest a word may be.
const MAX_WORDS = 8;
const MAX_WORD_LENGTH = 64;
// What Postgres's highlighter puts around a matched word: private-use characters, which are
// stripped from the text first, so no text can fake a match.
const START = "\uE000";
const STOP = "\uE001";
const MARKS = `StartSel=${START}, StopSel=${STOP}`;
// A message's stretch around its match: one fragment of up to 14 words.
const SNIPPET = `${MARKS}, MaxFragments=1, MaxWords=14, MinWords=5, ShortWord=2`;
// A title, whole, every match marked.
const WHOLE = `${MARKS}, HighlightAll=true`;

/**
 * The ctx's user's conversations whose title or one message holds every word of `query`, most
 * recently active first. A search with no words finds nothing, without asking the database.
 */
export async function searchConversations(ctx: Ctx, query: string): Promise<ConversationHit[]> {
  requirePerson(ctx);
  const words = wordsOf(query);
  if (words.length === 0) return [];
  // Every word, each as the start of a word. Stop words drop out.
  const search = sql`to_tsquery('english', ${words.map((word) => `${word}:*`).join(" & ")})`;
  const title = sql`coalesce(${agentConversations.title}, '')`;
  const titleMatches = sql`to_tsvector('english', ${title}) @@ ${search}`;
  const matchingMessages = and(
    eq(agentMessages.orgId, agentConversations.orgId),
    eq(agentMessages.conversationId, agentConversations.id),
    sql`${agentMessages.keywords} @@ ${search}`,
  );
  // A message's text parts as one text, as its keyword index reads them.
  const messageText = sql`(select string_agg(t.value, ' ') from jsonb_array_elements_text(
    jsonb_path_query_array(${agentMessages.parts}, ${TEXT_PARTS})
  ) as t(value))`;
  const unmarked = (text: SQL) => sql`translate(${text}, ${START + STOP}, '')`;
  const titleMatch = sql<string | null>`case when ${titleMatches}
    then ts_headline('english', ${unmarked(title)}, ${search}, ${WHOLE}) end`;
  // The best-matching message's stretch: the most matches closest together, then the earliest.
  const snippet = sql<string | null>`(
    select ts_headline('english', ${unmarked(messageText)}, ${search}, ${SNIPPET})
    from ${agentMessages} where ${matchingMessages}
    order by ts_rank_cd(${agentMessages.keywords}, ${search}) desc, ${agentMessages.seq}
    limit 1
  )`;

  const rows = await forOrg(ctx).select(agentConversations, {
    columns: ["id", "title", "updatedAt"],
    computed: { titleMatch, snippet },
    where: and(
      eq(agentConversations.ownerUserId, ctx.userId),
      or(titleMatches, sql`exists (select 1 from ${agentMessages} where ${matchingMessages})`),
    ),
    orderBy: [desc(agentConversations.updatedAt), desc(agentConversations.id)],
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt,
    titleMatch: row.titleMatch === null ? null : marked(row.titleMatch),
    snippet: row.snippet === null ? null : marked(row.snippet),
  }));
}

/**
 * The search's distinct words, lowercased: letters and digits only, so never query syntax, and
 * each cut to a length no real word reaches, so Postgres takes it.
 */
function wordsOf(query: string): string[] {
  const words = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((word) =>
    Array.from(word).slice(0, MAX_WORD_LENGTH).join(""),
  );
  return [...new Set(words)].slice(0, MAX_WORDS);
}

/** Highlighted text split at its marks, with whitespace runs made single spaces. */
function marked(highlighted: string): MarkedText {
  const [first = "", ...rest] = highlighted.replace(/\s+/g, " ").split(START);
  const pieces = [
    { text: first, match: false },
    ...rest.flatMap((chunk) => {
      const [match = "", after = ""] = chunk.split(STOP);
      return [
        { text: match, match: true },
        { text: after, match: false },
      ];
    }),
  ];
  return pieces.filter((piece) => piece.text !== "");
}
