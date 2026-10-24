// The alerts feature: notices telling admins something needs them, worked out from the current
// state of credits, connections and workflows on every read. Nothing is stored, so an alert
// never goes stale and there is nothing to dismiss. It reads other features' entry files;
// nothing imports it but pages.
import "server-only";
export { countAlerts, listAlerts } from "./lib/alerts";
