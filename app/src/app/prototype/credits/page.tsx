// PROTOTYPE, throwaway: variants of the admin Credits page (M7), switchable via ?variant=.
// Round 2 (D, E) sits in the sidebar shell and adds time series to B's breakdown; round 1 (A, B,
// C) stays for comparison. ?as=member shows what a member gets; ?credits=out (D, E) the out state.
import { prototypePage } from "../_shared/prototype-page";
import { SHELL_TOGGLES } from "../_shared/sidebar-shell";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";
import { VariantD } from "./variant-d";
import { VariantE } from "./variant-e";

export default prototypePage({
  variants: [
    { key: "D", name: "Breakdown over time", Component: VariantD },
    { key: "E", name: "One chart, many lenses", Component: VariantE },
    { key: "A", name: "Bank statement", Component: VariantA },
    { key: "B", name: "Breakdown first", Component: VariantB },
    { key: "C", name: "Runway forecast", Component: VariantC },
  ],
  toggles: [...SHELL_TOGGLES],
});
