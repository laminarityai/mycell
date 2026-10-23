import { Suspense } from "react";
import { AppShell } from "@/app/_shell/app-shell";
import { listAccessLog, listStaffConsents } from "@/features/memory/server";
import { AccessLog, StaffConsents } from "@/features/memory/ui";
import { getCtx } from "@/features/orgs/server";
import { workflowNames } from "@/features/workflows/server";
import { isAdmin } from "@/lib/ctx";

export default function AccessLogPage() {
  return (
    <AppShell current="memory-log" title="Memory access log" width="wide">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading the log…</p>}>
        <Log />
      </Suspense>
    </AppShell>
  );
}

async function Log() {
  const ctx = await getCtx();
  const admin = isAdmin(ctx);
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
