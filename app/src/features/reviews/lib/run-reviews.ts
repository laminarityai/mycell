// The reviews one run created, for the run's page: what each is and how it stands, never its
// item. An admin sees every run, so every review a run made, and may open those they may see
// (an org review, or one handed to them); a member only the ones they may see, their own.
import { asc, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { isAdmin, requireRole, type Ctx } from "@/lib/ctx";
import type { RunReview } from "../types";
import { visibleOf } from "./reviews";
import { reviews } from "./schema";

/** The reviews the run created, oldest first. One query, however many there are. */
export async function reviewsOfRun(ctx: Ctx, runId: string): Promise<RunReview[]> {
  requireRole(ctx, "admin", "member");
  const rows = await forOrg(ctx).select(reviews, {
    where: eq(reviews.runId, runId),
    orderBy: [asc(reviews.createdAt), asc(reviews.id)],
  });
  const openable = new Set((await visibleOf(ctx, rows)).map((row) => row.id));
  const listed = isAdmin(ctx) ? rows : rows.filter((row) => openable.has(row.id));
  return listed.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    createdAt: row.createdAt,
    endedAt: row.endedAt,
    openable: openable.has(row.id),
  }));
}
