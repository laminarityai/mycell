// PROTOTYPE, throwaway: variant B, kind-specific previews: cards instead of table rows, each
// showing what its kind holds at a glance, and the selected one opened beside the list with a
// full preview (an event card with time and guests to invite; a summary of what the suggested
// edits change, counts only).
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { asEnding } from "./review-copy";
import { SplitView } from "./variant-b-split";

export function VariantB({ params }: VariantProps) {
  return (
    <PrototypeMain wide>
      <PrototypeHeader title="Reviews" admin={false} />
      <SplitView ending={asEnding(params.state)} />
    </PrototypeMain>
  );
}
