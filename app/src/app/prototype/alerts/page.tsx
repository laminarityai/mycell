// PROTOTYPE, throwaway: where should an admin learn that something needs them, so they act on
// it, when Mycel sends no email and alerts clear themselves? Round 2 (D, E) puts Alerts in the
// sidebar shell, full width; round 1 (A, B, C) stays for comparison.
import { SHELL_TOGGLES } from "../_shared/sidebar-shell";
import { prototypePage } from "../_shared/prototype-page";
import { STATE_TOGGLE } from "./alert-data";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";
import { VariantD } from "./variant-d";
import { VariantE } from "./variant-e";

export default prototypePage({
  variants: [
    { key: "D", name: "Full-width table", Component: VariantD },
    { key: "E", name: "Full-width cards", Component: VariantE },
    { key: "A", name: "List by kind", Component: VariantA },
    { key: "B", name: "To-do cards", Component: VariantB },
    { key: "C", name: "Bell popover", Component: VariantC },
  ],
  toggles: [...SHELL_TOGGLES, STATE_TOGGLE],
});
