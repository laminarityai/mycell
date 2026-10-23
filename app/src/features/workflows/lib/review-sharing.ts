// What the reviews feature needs from a workflow (ADR-0013): an org review is seen by whoever
// sees its workflow through its tags (and every admin), it says which of those tags it's shared
// with, and a review is handed on only if the workflow's latest version allows it.
import { listMyTags, tagNamesById } from "@/features/tags/server";
import { type Ctx, isAdmin, isSystem } from "@/lib/ctx";
import type { ReviewSharing } from "../types";
import { latestVersions } from "./latest-versions";
import { tagIdsOf } from "./visibility";

/**
 * For each published workflow with one of these IDs in the caller's org, whether the caller
 * sees it now (by their tags as they are now; an admin and the system ctx see every one), the
 * names of the tags its latest version is published to that the caller may know (a member's
 * own among them; every one for an admin), and whether that version lets a review be handed
 * on. Any role may ask: it says nothing about a workflow but these answers. A workflow never
 * published, or not in the org, has no entry.
 */
export async function reviewSharing(
  ctx: Ctx,
  workflowIds: readonly string[],
): Promise<Map<string, ReviewSharing>> {
  const versions = [...(await latestVersions(ctx, [...new Set(workflowIds)])).values()];
  const tagIds = await tagIdsOf(
    ctx,
    versions.map((version) => version.id),
  );
  const everyone = isAdmin(ctx) || isSystem(ctx);
  // The tags the caller may name: every one of these versions' for an admin, else their own.
  const known = everyone
    ? await tagNamesById(ctx, [...tagIds.values()].flat())
    : new Map((await listMyTags(ctx)).map((tag) => [tag.id, tag.name]));
  return new Map(
    versions.map((version) => {
      const ids = tagIds.get(version.id) ?? [];
      return [
        version.workflowId,
        {
          seen: everyone || ids.some((id) => known.has(id)),
          handOff: version.spec.review?.handoff === true,
          tags: ids.flatMap((id) => known.get(id) ?? []).sort((a, b) => a.localeCompare(b)),
        },
      ];
    }),
  );
}
