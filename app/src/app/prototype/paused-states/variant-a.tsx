// PROTOTYPE, throwaway: variant A, today's pattern extended: each workflow is its own card with
// a "Paused: …" badge, and under it a notice saying why, what lifts it, and what still holds
// once it lifts. An admin's view adds a second list of shared-inbox switches.
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { CardList } from "./variant-a-list";

export function VariantA({ params }: VariantProps) {
  const admin = params.as === "admin";
  return (
    <PrototypeMain>
      <PrototypeHeader title="Workflows" admin={admin} />
      <CardList admin={admin} creditsOut={params.credits === "out"} />
    </PrototypeMain>
  );
}
