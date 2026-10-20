// The connections feature: links from a user or the org to an external source, made through
// Nango. It is the only feature that talks to Nango.
export { startConnect } from "./lib/connect";
export { deleteMemberConnectionsOf, disconnect } from "./lib/disconnect";
// The Inngest event a recorded connection sends; ingest jobs trigger on it.
export { connectionRecorded } from "./lib/events";
export { listConnections } from "./lib/list";
// Called only by the nightly reconciliation job and tests: it walks every org itself, acting
// inside each as its system ctx (ADR-0009).
export { reconcileConnections } from "./lib/reconcile";
// How other features ingest from a connection, without touching Nango or the table.
export {
  getConnection,
  listConnectionsForJobs,
  proxyGet,
  recordIngestState,
} from "./lib/source-access";
// Called only by the Nango webhook route and tests: it checks Nango's signature itself.
export { handleNangoWebhook } from "./lib/webhook";
