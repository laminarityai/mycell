import { Suspense } from "react";
import { AppNav } from "@/app/app-nav";
import { listAccessLog, listStaffConsents } from "@/features/memory/server";
import { AccessLog, StaffConsents } from "@/features/memory/ui";
import { getCtx } from "@/features/orgs/server";
import { workflowNames } from "@/features/workflows/server";

export default function AccessLogPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Memory access log</h1>
        <AppNav />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading the log…</p>}>
        <Log />
      </Suspense>
    </main>
  );
}

async function Log() {
  const ctx = await getCtx();
  const admin = ctx.role === "admin";
  const entries = await listAccessLog(ctx);
  const [names, consents] = await Promise.all([
    workflowNames(
      ctx,
      entries.flatMap((entry) => entry.reader.workflowId ?? []),
    ),
    admin ? listStaffConsents(ctx) : [],
  ]);
  return (
    <>
      {admin ? (
        <>
          <h2 className="text-lg font-medium">Staff access</h2>
          <StaffConsents consents={consents} now={new Date()} />
          <h2 className="text-lg font-medium">Reads</h2>
        </>
      ) : null}
      <AccessLog entries={entries} admin={admin} workflowNames={names} />
    </>
  );
}
