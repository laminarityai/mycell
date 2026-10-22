// PROTOTYPE, throwaway: how do held Calendar events and Docs suggested edits read beside Gmail
// drafts on the Reviews page, in the list and opened, without showing stored content?
import { prototypePage } from "../_shared/prototype-page";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export default prototypePage({
  variants: [
    { key: "A", name: "Rows + summary", Component: VariantA },
    { key: "B", name: "Kind previews", Component: VariantB },
    { key: "C", name: "Grouped by app", Component: VariantC },
  ],
  // How the opened Calendar and Docs reviews stand: still waiting, or ended in the app.
  toggles: [{ param: "state", options: ["waiting", "done_in_app", "gone"] }],
});
