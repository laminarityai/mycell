// What `pnpm credits:grant` does, apart from printing and exiting, so its tests can run it. Our
// team grants an org credits as its system ctx (ADR-0009, ADR-0010), always with a short note
// the company's admins see beside the grant on the Credits page.
import { z } from "zod";
import { getBalance, grantCredits } from "@/features/credits/server";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";

export const USAGE = [
  "Usage: pnpm credits:grant <orgId> <credits> <note>",
  '  note: what the credits are for, shown to the company\'s admins ("October allowance")',
].join("\n");

const argsSchema = z
  .tuple([z.string().min(1), z.coerce.number().positive()], z.string())
  .transform(([orgId, credits, ...note]) => ({ orgId, credits, note: note.join(" ").trim() }))
  .refine((args) => args.note !== "");

export type CommandResult = { exitCode: number; output: string };

export async function runGrantCreditsCommand(args: string[]): Promise<CommandResult> {
  const parsed = argsSchema.safeParse(args);
  if (!parsed.success) return { exitCode: 1, output: USAGE };
  const { orgId, credits, note } = parsed.data;
  if (!(await listOrgIds()).includes(orgId)) {
    return { exitCode: 1, output: `No org has the ID ${orgId}.` };
  }
  const ctx = systemCtx(orgId);
  // Work that stopped for want of credits goes on: the grant announces itself, so memory learns
  // what it postponed, and paused workflows start again, since a pause for credits is read from
  // the balance.
  await grantCredits(ctx, credits, note);
  return {
    exitCode: 0,
    output: `Granted ${String(credits)} credits (${note}). Org ${orgId} now has ${String(await getBalance(ctx))}.`,
  };
}
