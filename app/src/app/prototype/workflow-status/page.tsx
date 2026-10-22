// PROTOTYPE, throwaway: three variants of the status area on an admin's workflow page (M7 spent
// of budget, M8 paused: failing), switchable via ?variant=, in each ?state=.
import { prototypePage } from "../_shared/prototype-page";
import { STATES } from "./fixtures";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export default prototypePage({
  variants: [
    { key: "A", name: "Banner and spent line", Component: VariantA },
    { key: "B", name: "Status column", Component: VariantB },
    { key: "C", name: "Health tab", Component: VariantC },
  ],
  toggles: [{ param: "state", options: [...STATES] }],
});
