import { Suspense } from "react";
import { AppShell } from "@/app/_shell/app-shell";
import { getCtx, listRemovedUsers, listUsers } from "@/features/orgs/server";
import { OrgUsersTable, RemovedUsersTable, SignOutButton } from "@/features/orgs/ui";
import { listMyTags } from "@/features/tags/server";
import { MyTags } from "@/features/tags/ui";
import { isAdmin } from "@/lib/ctx";

export default function OrgPage() {
  return (
    <AppShell current="org" title="Your org" actions={<SignOutButton />}>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading users…</p>}>
        <OrgUsers />
      </Suspense>
    </AppShell>
  );
}

async function OrgUsers() {
  const ctx = await getCtx();
  const [users, myTags, removed] = await Promise.all([
    listUsers(ctx),
    listMyTags(ctx),
    isAdmin(ctx) ? listRemovedUsers(ctx) : [],
  ]);
  return (
    <>
      <MyTags tags={myTags} />
      <OrgUsersTable users={users} viewer={ctx} />
      <RemovedUsersTable removed={removed} />
    </>
  );
}
