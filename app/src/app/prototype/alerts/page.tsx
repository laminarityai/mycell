// PROTOTYPE, throwaway: where should an admin learn that something needs them, so they act on
// it, when Mycel sends no email and alerts clear themselves?
import { AS_TOGGLE } from "../_shared/header";
import { prototypePage } from "../_shared/prototype-page";
import { STATE_TOGGLE } from "./alert-data";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export default prototypePage({
  variants: [
    { key: "A", name: "List by kind", Component: VariantA },
    { key: "B", name: "To-do cards", Component: VariantB },
    { key: "C", name: "Bell popover", Component: VariantC },
  ],
  toggles: [AS_TOGGLE, STATE_TOGGLE],
});
