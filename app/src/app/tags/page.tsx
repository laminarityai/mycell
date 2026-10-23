import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCtx, listUsers } from "@/features/orgs/server";
import { listTags } from "@/features/tags/server";
import { TagsManager } from "@/features/tags/ui";
import { AppShell } from "@/app/_shell/app-shell";
import { isAdmin } from "@/lib/ctx";

export default function TagsPage() {
  return (
    <AppShell current="tags" title="Tags">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading tags…</p>}>
        <Tags />
      </Suspense>
    </AppShell>
  );
}

async function Tags() {
  const ctx = await getCtx();
  // Tags are admin-only to manage; members see their own on the org page.
  if (!isAdmin(ctx)) redirect("/");
  const [tags, users] = await Promise.all([listTags(ctx), listUsers(ctx)]);
  return <TagsManager tags={tags} users={users} />;
}
