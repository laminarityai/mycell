// Tags and publishing through the real paths, for any feature's tests: who can see a workflow
// is decided by the tags its latest version was published to (M5).
import { assignTag, createTag } from "@/features/tags/server";
import { publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";

/** Creates the tag `name` as `admin` and gives it to each user. Returns the tag's ID. */
export async function tagUsers(
  admin: Ctx,
  name: string,
  users: readonly { id: string }[],
): Promise<string> {
  const tag = await createTag(admin, name);
  for (const user of users) await assignTag(admin, tag.id, user.id);
  return tag.id;
}

/**
 * Saves `spec` as a new workflow called `name`, with `visibility.tags` set to `tags`, and
 * publishes it. The admin needs a connection the spec can run on.
 */
export async function publishTo(
  admin: Ctx,
  name: string,
  spec: Record<string, unknown>,
  tags: readonly string[],
) {
  const { id } = await saveWorkflow(admin, {
    name,
    spec: { ...spec, visibility: { tags: [...tags] } },
  });
  const version = await publishWorkflow(admin, id);
  return { workflowId: id, version };
}
