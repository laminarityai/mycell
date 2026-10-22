// The memory.lookup action (ADR-0023): the facts memory holds about the triggering message's
// sender, the sender's company, or a topic, in the view of whoever the run acts for. A run on a
// member connection acts for its owner (the enabling member, or the admin trying their own), so
// it reads as them; a run on an org connection acts for no one, so it reads as the org's system
// ctx and sees only company-wide facts. Every read is logged as the reader the caller names.
// Its facts go on to later steps (ADR-0021); its run record keeps only how many were found, since
// admins browse run records and a member's facts are theirs (ADR-0001).
import { z } from "zod";
import { getConnection } from "@/features/connections/server";
import { searchMemory } from "@/features/memory/server";
import type { MemoryReader, MemorySearch } from "@/features/memory/types";
import { listUsers } from "@/features/orgs/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { joinPrompts, type PromptText } from "@/lib/prompts";
import type { Json } from "../types";
import { RunStepError } from "./failures";
import { messageFacts } from "./gmail";
import { memoryLookupPrompts } from "./prompts";

export const MEMORY_LOOKUP = "memory.lookup";

/** The most facts one lookup hands on. */
const LOOKUP_LIMIT = 10;

export type LookupInput = {
  about: "sender" | "sender_company" | "topic";
  topic?: string;
};

const lookupOutputSchema = z.object({
  factCount: z.number(),
  facts: z.array(
    z.object({
      id: z.string(),
      about: z.string(),
      statement: z.string(),
      // Stated only from outside the company, against a fact from inside it (ADR-0023).
      disputed: z.boolean().optional(),
    }),
  ),
});
type LookupOutput = z.infer<typeof lookupOutputSchema>;

/**
 * Looks up `input` for a run on `connectionId` about the message `sourceRef`, logged as
 * `reader`. A sender with no company domain (a webmail address) finds nothing about a company.
 */
export async function lookUp(
  ctx: Ctx,
  run: { connectionId: string; sourceRef: string },
  input: LookupInput,
  reader: MemoryReader,
): Promise<LookupOutput> {
  const search = await searchFor(ctx, run, input);
  if (search === undefined) return { factCount: 0, facts: [] };
  const viewer = await viewerCtx(ctx, run.connectionId);
  const found = await searchMemory(viewer, search, reader);
  const facts = found.facts.map((fact) => ({
    id: fact.id,
    about: fact.subject.name,
    statement: fact.statement,
    ...(fact.conflictsWith === null ? {} : { disputed: true }),
  }));
  return { factCount: facts.length, facts };
}

async function searchFor(
  ctx: Ctx,
  run: { connectionId: string; sourceRef: string },
  input: LookupInput,
): Promise<MemorySearch | undefined> {
  if (input.about === "topic") return { text: input.topic ?? "", limit: LOOKUP_LIMIT };
  // Read from the message inside the step, never handed on. A message with no address in its
  // From header names no one to look up.
  const { sender, senderDomain } = await messageFacts(ctx, run.connectionId, run.sourceRef);
  const key =
    input.about === "sender"
      ? { kind: "email" as const, value: sender }
      : { kind: "domain" as const, value: senderDomain };
  return key.value === "" ? undefined : { key, limit: LOOKUP_LIMIT };
}

/**
 * Whose view a run on the connection reads memory in: its owner's for a member connection, the
 * org's system ctx (company-wide only) for an org connection. The owner's role is read fresh.
 */
async function viewerCtx(ctx: Ctx, connectionId: string): Promise<Ctx> {
  const connection = await getConnection(ctx, connectionId);
  if (connection.kind === "org") return systemCtx(ctx.orgId);
  const owner = (await listUsers(ctx)).find((user) => user.id === connection.ownerUserId);
  if (owner === undefined) {
    throw new RunStepError("not_available", "The connection's owner is no longer in the org.");
  }
  return { orgId: ctx.orgId, userId: owner.id, role: owner.role };
}

/** A lookup's facts as a draft step's model reads them. */
export function lookupText(stepId: string, output: Json): PromptText {
  const parsed = lookupOutputSchema.safeParse(output);
  const facts = parsed.success ? parsed.data.facts : [];
  if (facts.length === 0) return memoryLookupPrompts.nothing({ step: stepId });
  const lines = facts.map(({ about, statement, disputed }) =>
    disputed === true
      ? memoryLookupPrompts.disputedFact({ about, statement })
      : memoryLookupPrompts.fact({ about, statement }),
  );
  return memoryLookupPrompts.facts({ step: stepId, facts: joinPrompts(lines, "\n") });
}
