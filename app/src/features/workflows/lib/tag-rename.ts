// Following a renamed tag (M5). Published versions reach a tag by its ID, so a rename never
// changes who sees a workflow; but working specs name their tags (`visibility.tags`), and
// publishing resolves names. So when a tag is renamed, a job rewrites every working spec that
// names it under its old name, and the next publish (from the dialog or the builder) finds it.
import { and, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { StoredSpec } from "@/features/spec/stored";
import { tagNamesById } from "@/features/tags/server";
import { type Ctx, requireRole } from "@/lib/ctx";
import { workflows } from "./schema";

// A save racing the rewrite moves the revision on; the rewrite reads the spec again and retries.
const ATTEMPTS = 3;

/**
 * Renames the tag `from` to the tag's current name in every working spec that names it, each as
 * a save (the revision moves on, so an editor opened before can't save the old name back). Uses
 * the tag's name as it is now, not the one the event carried, so renames followed out of order
 * still end on the current name. Nothing changes when the tag is gone or `from` is its current
 * name. Returns how many working specs changed. Admins and the system ctx (its job) may ask.
 */
export async function followTagRename(
  ctx: Ctx,
  rename: { tagId: string; from: string },
): Promise<number> {
  requireRole(ctx, "admin", "system");
  const to = (await tagNamesById(ctx, [rename.tagId])).get(rename.tagId);
  if (to === undefined || to === rename.from) return 0;
  const db = forOrg(ctx);
  const naming = (await db.select(workflows)).filter((row) => names(row.workingSpec, rename.from));
  let changed = 0;
  for (const { id } of naming) {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const row = (await db.select(workflows, { where: eq(workflows.id, id), limit: 1 })).at(0);
      if (row === undefined || !names(row.workingSpec, rename.from)) break;
      const saved = await db.update(
        workflows,
        {
          workingSpec: renamed(row.workingSpec, rename.from, to),
          revision: row.revision + 1,
          updatedAt: new Date(),
        },
        and(eq(workflows.id, id), eq(workflows.revision, row.revision)),
      );
      if (saved.length > 0) {
        changed += 1;
        break;
      }
    }
  }
  return changed;
}

function names(spec: StoredSpec, tag: string): boolean {
  return spec.visibility?.tags.includes(tag) === true;
}

// The spec, in the version it was saved in, with `from` renamed to `to` in its tags, each once.
function renamed(spec: StoredSpec, from: string, to: string): StoredSpec {
  const tags = (spec.visibility?.tags ?? []).map((tag) => (tag === from ? to : tag));
  return { ...spec, visibility: { tags: [...new Set(tags)] } };
}
