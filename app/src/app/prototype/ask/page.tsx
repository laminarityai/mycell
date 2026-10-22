// PROTOTYPE, throwaway: how should a person's private chat with Mycel show answers, their
// sources, and the things it can do (find a message, run a workflow, remember a fact)?
import { AS_TOGGLE } from "../_shared/header";
import { prototypePage } from "../_shared/prototype-page";
import { GOOGLE_TOGGLE } from "./threads";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export default prototypePage({
  variants: [
    { key: "A", name: "Chat + rail", Component: VariantA },
    { key: "B", name: "Answer + sources pane", Component: VariantB },
    { key: "C", name: "Structured turns", Component: VariantC },
  ],
  toggles: [AS_TOGGLE, GOOGLE_TOGGLE],
});
