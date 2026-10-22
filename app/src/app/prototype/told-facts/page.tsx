// PROTOTYPE, throwaway: how should a person see, check and delete everything they've told
// Mycel, with the older notes each one replaced?
import { AS_TOGGLE } from "../_shared/header";
import { prototypePage } from "../_shared/prototype-page";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export default prototypePage({
  variants: [
    { key: "A", name: "By person or company", Component: VariantA },
    { key: "B", name: "Chronological table", Component: VariantB },
    { key: "C", name: "Drawer in the chat", Component: VariantC },
  ],
  toggles: [AS_TOGGLE],
});
