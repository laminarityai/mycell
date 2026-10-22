// Company-wide lists (ADR-0023): group addresses, such as all@, an admin marked so email sent to
// them is visible to everyone. Google tells only admins who is in a group, which Mycel doesn't
// use (ADR-0008), so marking is the one way a group counts for people whose own mailbox lacks
// the email. Only a group at the company's Workspace domain can be marked, never a person's
// own address, which would show everyone their mail.
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { forOrg } from "@/db/for-org";
import { getWorkspaceDomain, listUsers } from "@/features/orgs/server";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ValidationError } from "@/lib/errors";
import type { CompanyWideList } from "../types";
import { companyWideLists } from "./schema";

const addressSchema = z.string().trim().toLowerCase().pipe(z.email());

/** Marks the group address company-wide; marking it again changes nothing. Admins only. */
export async function markCompanyWideList(ctx: Ctx, address: string): Promise<void> {
  requireAdmin(ctx);
  const list = await listAddress(ctx, address);
  await forOrg(ctx).insert(companyWideLists, { address: list }, { onConflictDoNothing: true });
}

/** Takes the mark off; email sent to it counts again only for the people it reached. */
export async function unmarkCompanyWideList(ctx: Ctx, address: string): Promise<void> {
  requireAdmin(ctx);
  await forOrg(ctx).delete(
    companyWideLists,
    eq(companyWideLists.address, address.trim().toLowerCase()),
  );
}

/** The org's company-wide lists, by address. Admins only. */
export async function listCompanyWideLists(ctx: Ctx): Promise<CompanyWideList[]> {
  requireAdmin(ctx);
  const rows = await forOrg(ctx).select(companyWideLists, {
    orderBy: [asc(companyWideLists.address)],
  });
  return rows.map(({ address, markedAt }) => ({ address, markedAt }));
}

/** Every address marked company-wide in the org: for visibility, so any ctx may ask. */
export async function markedAddresses(ctx: Ctx): Promise<string[]> {
  return (await forOrg(ctx).select(companyWideLists)).map((row) => row.address);
}

async function listAddress(ctx: Ctx, input: string): Promise<string> {
  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Give the list's email address.");
  const address = parsed.data;
  const domain = (await getWorkspaceDomain(ctx)).toLowerCase();
  if (!address.endsWith(`@${domain}`)) {
    throw new ValidationError(`Only a list at ${domain} can be marked company-wide.`);
  }
  const people = await listUsers(ctx);
  if (people.some((user) => user.email.toLowerCase() === address)) {
    throw new ValidationError("That's a person's own address, not a list.");
  }
  return address;
}
