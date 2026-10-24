// The discovery feature. For now it is ingest only: connectors, backfill, polling, events and
// object refs. Mining, ranking and shadow eval join it in M2.
import "server-only";
export { backfillConnection, markBackfillFailed } from "./lib/backfill";
export { findEventsByObject } from "./lib/find";
export { pollConnection } from "./lib/poll";
// The items it stored, listed again: memory counts them for its estimate and learns from them.
export { countStoredItems, listStoredItems } from "./lib/stored-items";
// Called only by the polling cron, which has no ctx until it picks an org (ADR-0009), and for
// its schedule, which depends on the environment's push settings.
export { pollAllConnections, sweepSchedule } from "./lib/poll-all";
// Called only by the renew-watches cron, as each org's system ctx (ADR-0026).
export { renewWatches } from "./lib/watch";
// Called only by the Gmail push route and tests: it checks Google's token itself, and has no
// ctx until it finds the mailbox's org (ADR-0026).
export { handleGmailPush } from "./lib/gmail-push";
// Called only by the Drive push route and tests: it checks the channel's token itself, and has
// no ctx until the token names the org (ADR-0026).
export { handleDrivePush } from "./lib/drive-push";
