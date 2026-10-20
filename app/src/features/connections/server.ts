// The connections feature: links from a user or the org to an external account, made through
// Nango. It is the only feature that talks to Nango.
export { startConnect } from "./lib/connect";
export { deleteMemberConnectionsOf, disconnect } from "./lib/disconnect";
// The Inngest events that start a backfill: a connection was recorded, or a reconnect granted
// it an ingested app it didn't have. Ingest jobs trigger on them.
export { connectionAppsGranted, connectionRecorded } from "./lib/events";
export { listConnections } from "./lib/list";
// Called only by the nightly reconciliation job and tests: it walks every org itself, acting
// inside each as its system ctx (ADR-0009).
export { reconcileConnections } from "./lib/reconcile";
export { startReconnect } from "./lib/reconnect";
// How other features use a connection, without touching Nango or the table: what it is and
// was granted, GETs and POSTs to its Google APIs, and where each ingested app stands.
export {
  getConnection,
  getGrantedScopes,
  listConnectionsForJobs,
  proxyGet,
  proxyPost,
  recordIngestState,
} from "./lib/source-access";
// Called only by the Nango webhook route and tests: it checks Nango's signature itself.
export { handleNangoWebhook } from "./lib/webhook";
