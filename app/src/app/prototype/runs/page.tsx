// PROTOTYPE, throwaway: how should the Runs page let an admin find the run that matters among
// thousands, across workflows, without reading a colleague's mail?
import { AS_TOGGLE } from "../_shared/header";
import { prototypePage } from "../_shared/prototype-page";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export default prototypePage({
  variants: [
    { key: "A", name: "Dense table", Component: VariantA },
    { key: "B", name: "By workflow, health strips", Component: VariantB },
    { key: "C", name: "Inbox split view", Component: VariantC },
  ],
  toggles: [AS_TOGGLE],
});
