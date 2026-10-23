// The runtime feature: the interpreter and its run records.
// Called by the run-workflow job and tests, as the org's system ctx.
import "server-only";
export { executeRun, failCrashedRun } from "./lib/interpreter";
export { getRun, listRuns, startRun } from "./lib/runs";
// For a workflow paused for failing: the runs that paused it, as its Health check lists them.
export { pausingRuns } from "./lib/pausing-runs";
// "Try it": a spec on one message, in memory, with every write stubbed. Nothing is stored.
export { dryRun } from "./lib/dry-run";
export { recentMessages } from "./lib/recent-messages";
// For the builder's read_examples: a Gmail search and each message's fields, held in memory by
// the caller (invariant 8).
export { readMessage, searchMessages } from "./lib/gmail";
// Called by the trigger's fan-out job and tests, as the org's system ctx: the runs one new
// inbound message starts.
export { startTriggeredRuns } from "./lib/trigger";
