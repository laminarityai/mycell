// PROTOTYPE, throwaway: how does a member tell, at a glance, which workflows are paused, why,
// and whether they must act, when up to four pause reasons can hold at once?
import { prototypePage } from "../_shared/prototype-page";
import { VariantA } from "./variant-a";
import { VariantA2 } from "./variant-a2";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export default prototypePage({
  variants: [
    { key: "A2", name: "Badge + notice, round 2", Component: VariantA2 },
    { key: "A", name: "Badge + notice", Component: VariantA },
    { key: "B", name: "Grouped banner", Component: VariantB },
    { key: "C", name: "Status timeline", Component: VariantC },
  ],
  // Out of credits pauses every switched-on workflow, so it's a toggle: with it on, it shows
  // first everywhere and the other reasons wait behind it. The same params as SHELL_TOGGLES,
  // A2's sidebar reads them too, but member first, as round 1 opened on a member's view.
  toggles: [
    { param: "as", options: ["member", "admin"] },
    { param: "credits", options: ["ok", "out"] },
  ],
});
