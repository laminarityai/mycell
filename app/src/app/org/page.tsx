import Link from "next/link";
import { Suspense } from "react";
import { getCtx, listUsers } from "@/features/orgs/server";
import { OrgUsersTable, SignOutButton } from "@/features/orgs/ui";
import { listMyTags } from "@/features/tags/server";
import { MyTags } from "@/features/tags/ui";

export default function OrgPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your org</h1>
        <SignOutButton />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading users…</p>}>
        <OrgUsers />
      </Suspense>
    </main>
  );
}

async function OrgUsers() {
  const ctx = await getCtx();
  const [users, myTags] = await Promise.all([listUsers(ctx), listMyTags(ctx)]);
  return (
    <>
      <MyTags tags={myTags} />
      <nav className="flex gap-4">
        <Link href="/reviews" className="text-sm font-medium underline-offset-4 hover:underline">
          Reviews
        </Link>
        <Link
          href="/connections"
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          Connections
        </Link>
        <Link href="/workflows" className="text-sm font-medium underline-offset-4 hover:underline">
          Workflows
        </Link>
        {ctx.role === "admin" ? (
          <>
            <Link href="/tags" className="text-sm font-medium underline-offset-4 hover:underline">
              Manage tags
            </Link>
            <Link
              href="/builder"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              Builder chat
            </Link>
          </>
        ) : null}
      </nav>
      <OrgUsersTable users={users} viewer={ctx} />
    </>
  );
}
