import { eq } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import { getDb } from "@/db/client";
import type { Ctx } from "@/lib/ctx";
import type { OrgSettings } from "../types";

/** The Workspace domain the caller's org was created for (ADR-0002), such as `example.com`. */
export async function getWorkspaceDomain(ctx: Ctx): Promise<string> {
  return (await getOrgSettings(ctx)).workspaceDomain;
}

/** The caller's org's name and Workspace domain. */
export async function getOrgSettings(ctx: Ctx): Promise<OrgSettings> {
  const rows = await getDb()
    .select({ name: organization.name, workspaceDomain: organization.workspaceDomain })
    .from(organization)
    .where(eq(organization.id, ctx.orgId));
  const row = rows.at(0);
  if (row === undefined) throw new Error("The caller's org doesn't exist");
  return row;
}
