// PROTOTYPE, throwaway: how should a person's private chat with Mycel show answers, their
// sources, and the things it can do (find a message, run a workflow, remember a fact)?
import { prototypePage } from "../_shared/prototype-page";
import { SHELL_TOGGLES } from "../_shared/sidebar-shell";
import { GOOGLE_TOGGLE } from "./threads";
import { VariantA } from "./variant-a";
import { VariantA2 } from "./variant-a2";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export default prototypePage({
  variants: [
    { key: "A2", name: "Chat + rail, round 2", Component: VariantA2 },
    { key: "A", name: "Chat + rail", Component: VariantA },
    { key: "B", name: "Answer + sources pane", Component: VariantB },
    { key: "C", name: "Structured turns", Component: VariantC },
  ],
  // Round 1 ignores `credits`; A2's sidebar shows the admin's out-of-credits banner with it.
  toggles: [...SHELL_TOGGLES, GOOGLE_TOGGLE],
});
