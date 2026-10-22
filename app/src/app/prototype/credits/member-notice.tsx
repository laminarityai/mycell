// PROTOTYPE, throwaway: what a member gets at /credits in every variant. The real page redirects
// them home, as the workflow page does today, and the nav never links it; this stands in for that.
import Link from "next/link";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import { SidebarShell } from "../_shared/sidebar-shell";

function NoticeBody() {
  return (
    <div className="flex max-w-3xl flex-col gap-2 rounded-md border border-dashed p-6 text-sm">
      <p className="font-medium">A member never sees this page.</p>
      <p className="text-muted-foreground">
        Opening /credits as a member redirects to the Workflows page, and the navigation has no
        Credits link. A member learns about credits only from a pause: their switched-on workflows
        show &ldquo;Paused: out of credits&rdquo; or &ldquo;Paused: budget reached&rdquo;.
      </p>
      <Link href="/prototype/paused-states?as=member" className="w-fit underline">
        See the paused states a member gets
      </Link>
    </div>
  );
}

export function MemberNotice() {
  return (
    <PrototypeMain>
      <PrototypeHeader title="Workflows" admin={false} />
      <NoticeBody />
    </PrototypeMain>
  );
}

/** Round 2's member notice, inside the sidebar shell. */
export function ShellMemberNotice({ params }: { params: Record<string, string> }) {
  return (
    <SidebarShell params={params} current="workflows" title="Workflows">
      <NoticeBody />
    </SidebarShell>
  );
}
