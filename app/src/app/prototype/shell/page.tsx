// PROTOTYPE, throwaway: how does the navigation hold up to 14 links for an admin (v1 adds Ask
// Mycel, Runs, Alerts, Credits) plus an out-of-credits banner, without drowning the page?
import { AS_TOGGLE } from "../_shared/header";
import { prototypePage } from "../_shared/prototype-page";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export default prototypePage({
  variants: [
    { key: "A", name: "Flat row", Component: VariantA },
    { key: "B", name: "Grouped sidebar", Component: VariantB },
    { key: "C", name: "Slim bar + Admin menu", Component: VariantC },
  ],
  toggles: [AS_TOGGLE, { param: "credits", options: ["ok", "out"] }],
});
