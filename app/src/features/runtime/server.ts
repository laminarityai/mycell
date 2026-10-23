// The runtime feature: the interpreter and its run records.
// Called by the run-workflow job and tests, as the org's system ctx.
import "server-only";
export { executeRun, failCrashedRun } from "./lib/interpreter";
// An admin starting a run by hand on a message, as a debugging aid.
export { startRun } from "./lib/runs";
// The Runs page: runs across every workflow, newest first, filtered and paged. An admin sees
// every run, a colleague's redacted; a member sees the runs on their own inbox (ADR-0001).
export { listRuns } from "./lib/run-list";
export { listRunFilters } from "./lib/run-filters";
// A run's page, by the same rules: its steps, version and path, and the message it ran on for
// its connection's readers.
export { getRun, getRunMessage } from "./lib/run-details";
// Retrying a failed run on the same message, by whoever reads its connection: the owning member,
// or an admin for an org connection; and whether the caller may, for the run page's button.
export { checkRetry, retryRun } from "./lib/retries";
// "Try it": a spec on one message, in memory, with every write stubbed. Nothing is stored.
export { dryRun } from "./lib/dry-run";
export { recentMessages } from "./lib/recent-messages";
// For the builder's read_examples: a Gmail search and each message's fields, held in memory by
// the caller (invariant 8).
export { readMessage, searchMessages } from "./lib/gmail";
// Called by the trigger's fan-out job and tests, as the org's system ctx: the runs one new
// inbound message starts.
export { startTriggeredRuns } from "./lib/trigger";
