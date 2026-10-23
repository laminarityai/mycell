// The connections feature: links from a user or the org to an external account, made through
// Nango. It is the only feature that talks to Nango.
// Which connection a run reaches another registered app through, for custom actions.
import "server-only";
export { connectionToApp } from "./lib/app-connection";
export { startConnect } from "./lib/connect";
export { deleteMemberConnectionsOf, disconnect } from "./lib/disconnect";
// The Inngest events that start a backfill: a connection was recorded, or a reconnect granted
// it an ingested app it didn't have, or one whose backfill failed. Ingest jobs trigger on them.
export { connectionAppsGranted, connectionRecorded } from "./lib/events";
export { listConnections, sharedInboxes } from "./lib/list";
// The one rule for which connections an admin may build on: their own and the org's, granted
// Gmail. Used by the builder's read_examples and context, Try it, and spec validation.
export {
  buildableConnections,
  gmailConnections,
  requireBuildableConnection,
} from "./lib/buildable";
// Called only by the nightly reconciliation job and tests: it walks every org itself, acting
// inside each as its system ctx (ADR-0009).
export { reconcileConnections } from "./lib/reconcile";
// Called only by the Gmail push route, as the org's system ctx it found from the address.
export { gmailPushConnectionIds } from "./lib/gmail-push";
export { startReconnect } from "./lib/reconnect";
// How other features use a connection, without touching Nango or the table: what it is and
// was granted, which ones the caller may read, GETs, POSTs, PUTs, PATCHes and DELETEs to its app,
// and where each ingested app stands.
export {
  getConnection,
  getGrantedScopes,
  listConnectionsForJobs,
  proxyDelete,
  proxyGet,
  proxyGetText,
  proxyPatch,
  proxyPost,
  proxyPut,
  readableConnectionIds,
  recordIngestState,
  sourceClient,
} from "./lib/source-access";
// Called only by the Nango webhook route and tests: it checks Nango's signature itself.
export { handleNangoWebhook } from "./lib/webhook";
