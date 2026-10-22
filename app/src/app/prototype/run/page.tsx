// PROTOTYPE, throwaway: what should one run's page lead with so an admin or a member can see
// where it went wrong and what to do, without an admin reading a colleague's mail?
import { AS_TOGGLE } from "../_shared/header";
import { prototypePage } from "../_shared/prototype-page";
import { RUN_TOGGLE, VIEW_TOGGLE } from "./run-view";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export default prototypePage({
  variants: [
    { key: "A", name: "Step timeline", Component: VariantA },
    { key: "B", name: "Graph first", Component: VariantB },
    { key: "C", name: "What happened, then steps", Component: VariantC },
  ],
  toggles: [AS_TOGGLE, VIEW_TOGGLE, RUN_TOGGLE],
});
