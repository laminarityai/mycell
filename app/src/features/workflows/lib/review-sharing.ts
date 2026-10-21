// What the reviews feature needs from a workflow (ADR-0013): an org review is seen by whoever
// sees its workflow through its tags (and every admin), and a review is handed on only if the
// workflow's latest version allows it.
import type { Ctx } from "@/lib/ctx";
import type { ReviewSharing } from "../types";
import { latestVersions } from "./latest-versions";
import { sharingATag } from "./visibility";

/**
 * For each published workflow with one of these IDs in the caller's org, whether the caller
 * sees it now (by their tags as they are now; an admin and the system ctx see every one) and
 * whether its latest version lets a review be handed on. Any role may ask: it says nothing about
 * a workflow but these two answers. A workflow never published, or not in the org, has no entry.
 */
export async function reviewSharing(
  ctx: Ctx,
  workflowIds: readonly string[],
): Promise<Map<string, ReviewSharing>> {
  const latest = await latestVersions(ctx, [...new Set(workflowIds)]);
  const published = [...latest.values()].map((version) => ({ version }));
  const everyone = ctx.role === "admin" || ctx.role === "system";
  const seen = new Set(
    (everyone
      ? published
      : await sharingATag(
          ctx,
          published,
          published.map(({ version }) => version.id),
        )
    ).map(({ version }) => version.workflowId),
  );
  return new Map(
    published.map(({ version }) => [
      version.workflowId,
      { seen: seen.has(version.workflowId), handOff: version.spec.review?.handoff === true },
    ]),
  );
}
