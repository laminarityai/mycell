// PROTOTYPE, throwaway: variant C, grouped by app: Gmail, Calendar and Docs each get a section
// with select-all and bulk approve or decline in that app's words; rows are one dense line, and
// Open shows the full review in a dialog. Tasks Mycel added close the page, needing no review.
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { asEnding } from "./review-copy";
import { AppGroups } from "./variant-c-groups";

export function VariantC({ params }: VariantProps) {
  return (
    <PrototypeMain>
      <PrototypeHeader title="Reviews" admin={false} />
      <AppGroups ending={asEnding(params.state)} />
    </PrototypeMain>
  );
}
