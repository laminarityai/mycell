// PROTOTYPE, throwaway: three variants of the admin Credits page (M7), switchable via ?variant=;
// ?as=member shows what a member gets instead.
import { AS_TOGGLE } from "../_shared/header";
import { prototypePage } from "../_shared/prototype-page";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export default prototypePage({
  variants: [
    { key: "A", name: "Bank statement", Component: VariantA },
    { key: "B", name: "Breakdown first", Component: VariantB },
    { key: "C", name: "Runway forecast", Component: VariantC },
  ],
  toggles: [AS_TOGGLE],
});
