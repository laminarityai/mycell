// Grants credits to an org by ID, for our team (ADR-0010; there's no UI until M7). Run it from
// the repo root against the database in app/.env:
//
//   pnpm credits:grant <orgId> <credits>
import { z } from "zod";
import { getBalance, grantCredits } from "@/features/credits/server";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import { sendCreditsGranted } from "@/lib/events";

const argsSchema = z.tuple([z.string().min(1), z.coerce.number().positive()]);

async function main(): Promise<void> {
  const parsed = argsSchema.safeParse(process.argv.slice(2));
  if (!parsed.success) {
    console.error("Usage: pnpm credits:grant <orgId> <credits>");
    process.exit(1);
  }
  const [orgId, credits] = parsed.data;
  if (!(await listOrgIds()).includes(orgId)) {
    console.error(`No org has the ID ${orgId}.`);
    process.exit(1);
  }
  const ctx = systemCtx(orgId);
  await grantCredits(ctx, credits);
  // Work that stopped for want of credits goes on: memory learns what it postponed.
  await sendCreditsGranted(orgId);
  console.log(
    `Granted ${String(credits)} credits. Org ${orgId} now has ${String(await getBalance(ctx))}.`,
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
