import { eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { tags } from "./schema";

/** Throws NotFoundError unless the tag is in the caller's org. */
export async function requireTag(ctx: Ctx, tagId: string): Promise<void> {
  const rows = await forOrg(ctx).select(tags, { where: eq(tags.id, tagId), limit: 1 });
  if (rows.length === 0) throw new NotFoundError("tag");
}
