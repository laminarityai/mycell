import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCtx, listUsers } from "@/features/orgs/server";
import { listTags } from "@/features/tags/server";
import { TagsManager } from "@/features/tags/ui";

export default function TagsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Tags</h1>
        <Link href="/org" className="text-sm text-muted-foreground hover:text-foreground">
          Back to your org
        </Link>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading tags…</p>}>
        <Tags />
      </Suspense>
    </main>
  );
}

async function Tags() {
  const ctx = await getCtx();
  // Tags are admin-only to manage; members see their own on the org page.
  if (ctx.role !== "admin") redirect("/");
  const [tags, users] = await Promise.all([listTags(ctx), listUsers(ctx)]);
  return <TagsManager tags={tags} users={users} />;
}
