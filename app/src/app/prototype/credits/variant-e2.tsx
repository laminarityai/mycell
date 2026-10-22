// PROTOTYPE, throwaway: variant E2, "One chart, many lenses, with dates". E with a date range
// beside the title (this month, last month, the last 3 or 12 months, or custom days), kept in
// the URL. The range drives the chart, the breakdown, the spending and the ledger; the balance
// and runway stay now. History goes back to Oct 2025, when the company started.
import { SidebarShell } from "../_shared/sidebar-shell";
import type { VariantProps } from "../_shared/prototype-page";
import { ShellMemberNotice } from "./member-notice";
import { RangeControl } from "./range-control";
import { RangePanel } from "./range-panel";

export function VariantE2({ params }: VariantProps) {
  if (params.as === "member") return <ShellMemberNotice params={params} />;
  return (
    <SidebarShell
      params={params}
      current="credits"
      title="Credits"
      width="wide"
      actions={<RangeControl />}
    >
      <RangePanel out={params.credits === "out"} />
    </SidebarShell>
  );
}
