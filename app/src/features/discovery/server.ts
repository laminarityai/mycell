// The discovery feature. For now it is ingest only: connectors, backfill, polling, events and
// object refs. Mining, ranking and shadow eval join it in M2.
export { backfillConnection, markBackfillFailed } from "./lib/backfill";
export { findEventsByObject } from "./lib/find";
export { pollConnection } from "./lib/poll";
// Called only by the polling cron, which has no ctx until it picks an org (ADR-0009).
export { pollAllConnections } from "./lib/poll-all";
