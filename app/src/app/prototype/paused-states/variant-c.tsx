// PROTOTYPE, throwaway: variant C, a status table: what each switch is, since when, and what
// lifts it, with a timeline under every paused row showing each pause that holds and the order
// they lift in (credits back, then still budget reached, then runs again).
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { StatusTable } from "./variant-c-table";

export function VariantC({ params }: VariantProps) {
  const admin = params.as === "admin";
  return (
    <PrototypeMain wide>
      <PrototypeHeader title="Workflows" admin={admin} />
      <StatusTable admin={admin} creditsOut={params.credits === "out"} />
    </PrototypeMain>
  );
}
