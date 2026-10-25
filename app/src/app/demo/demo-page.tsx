import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { getCtx } from "@/features/orgs/server";
import { DemoNav } from "@/features/demo/ui";
import { AppShell } from "@/app/_shell/app-shell";
import { isAdmin } from "@/lib/ctx";

// Every demo page: signed in, with the demo's own section links above it. Admin screens 404 for
// members, as they would in the product; Chat is open to everyone.
export function DemoPage({
  title,
  adminOnly = true,
  children,
}: {
  title: string;
  adminOnly?: boolean;
  children: (admin: boolean) => ReactNode;
}) {
  return (
    <AppShell title={title} width="full">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading the demo…</p>}>
        <Gate adminOnly={adminOnly}>{children}</Gate>
      </Suspense>
    </AppShell>
  );
}

async function Gate({
  adminOnly,
  children,
}: {
  adminOnly: boolean;
  children: (admin: boolean) => ReactNode;
}) {
  const admin = isAdmin(await getCtx());
  if (adminOnly && !admin) notFound();
  return (
    <div className="space-y-6">
      <DemoNav />
      {children(admin)}
    </div>
  );
}
