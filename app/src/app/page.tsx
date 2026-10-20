import { Suspense } from "react";
import { getCtx, listUsers } from "@/features/orgs/server";
import { OrgUsersTable, SignOutButton } from "@/features/orgs/ui";

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
  return <OrgUsersTable users={await listUsers(ctx)} viewer={ctx} />;
}
