// PROTOTYPE, throwaway: round 2 of variant A inside the chosen sidebar shell. Each workflow
// card shows the apps it uses as small marks, and a pause that comes from one app names it
// with its mark in the notice.
import type { VariantProps } from "../_shared/prototype-page";
import { SidebarShell } from "../_shared/sidebar-shell";
import { CardListA2 } from "./variant-a2-list";

export function VariantA2({ params }: VariantProps) {
  return (
    <SidebarShell params={params} current="workflows" title="Workflows">
      <CardListA2 admin={params.as === "admin"} creditsOut={params.credits === "out"} />
    </SidebarShell>
  );
}
