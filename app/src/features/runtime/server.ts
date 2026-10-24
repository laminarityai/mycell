// The runtime feature: the interpreter and its run records.
// Called by the run-workflow job and tests, as the org's system ctx.
import "server-only";
export { executeRun, failCrashedRun } from "./lib/interpreter";
export { getRun, startRun } from "./lib/runs";
// The Runs page: runs across every workflow, newest first, filtered and paged. An admin sees
// every run, a colleague's redacted; a member sees the runs on their own inbox (ADR-0001).
export { listRuns } from "./lib/run-list";
export { listRunFilters } from "./lib/run-filters";
// "Try it": a spec on one message, in memory, with every write stubbed. Nothing is stored.
export { dryRun } from "./lib/dry-run";
export { recentMessages } from "./lib/recent-messages";
// For the builder's read_examples: a Gmail search and each message's fields, held in memory by
// the caller (invariant 8).
export { readMessage, searchMessages } from "./lib/gmail";
// Ask Mycel's runs: a person runs one of their own switched-on workflows on a message in their
// own mail, checked first as fan-out would; and what the chat shows of the runs it offered.
export { checkRunFromAgent, startRunFromAgent } from "./lib/agent-runs";
export { agentRunDetails } from "./lib/agent-run-details";
// Called by the trigger's fan-out job and tests, as the org's system ctx: the runs one new
// inbound message starts.
export { startTriggeredRuns } from "./lib/trigger";
