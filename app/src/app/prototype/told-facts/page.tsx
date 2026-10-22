// PROTOTYPE, throwaway: how should a person see, check and delete everything they've told
// Mycel, with the older notes each one replaced?
import { prototypePage } from "../_shared/prototype-page";
import { SHELL_TOGGLES } from "../_shared/sidebar-shell";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantB2 } from "./variant-b2";
import { VariantC } from "./variant-c";

export default prototypePage({
  variants: [
    { key: "B2", name: "Table, round 2", Component: VariantB2 },
    { key: "A", name: "By person or company", Component: VariantA },
    { key: "B", name: "Chronological table", Component: VariantB },
    { key: "C", name: "Drawer in the chat", Component: VariantC },
  ],
  // Round 1 reads only `as`; B2's sidebar also takes `credits`.
  toggles: SHELL_TOGGLES,
});
