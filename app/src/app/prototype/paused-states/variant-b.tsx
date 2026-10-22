// PROTOTYPE, throwaway: variant B, one banner above the list explaining what's paused and why,
// grouped by reason in M7's order with each fix beside its workflow; the rows themselves stay
// quiet (a dimmed name, "Paused", the switch).
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { BannerList } from "./variant-b-list";

export function VariantB({ params }: VariantProps) {
  const admin = params.as === "admin";
  return (
    <PrototypeMain>
      <PrototypeHeader title="Workflows" admin={admin} />
      <BannerList admin={admin} creditsOut={params.credits === "out"} />
    </PrototypeMain>
  );
}
