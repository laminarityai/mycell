import { Suspense } from "react";
import { AppNav } from "@/app/app-nav";
import { getCtx, listUsers } from "@/features/orgs/server";
import { OrgUsersTable, SignOutButton } from "@/features/orgs/ui";
import { listMyTags } from "@/features/tags/server";
import { MyTags } from "@/features/tags/ui";

export default function OrgPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your org</h1>
        <div className="flex flex-wrap items-center gap-4">
          <AppNav />
          <SignOutButton />
        </div>
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
      <OrgUsersTable users={users} viewer={ctx} />
    </>
  );
}
