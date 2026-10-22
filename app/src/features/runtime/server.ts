// The runtime feature: the interpreter and its run records, model roles and the AI Gateway
// client.
export { callModel } from "./lib/call-model";
export { classify } from "./lib/classify";
// Called by the run-workflow job and tests, as the org's system ctx.
export { executeRun } from "./lib/interpreter";
export { resolveModel, setModelRole } from "./lib/model-roles";
// For callers that stream a model themselves (the builder chat): the role's model, behind the
// credit check, and its one usage entry when the stream ends.
export { openMeteredStream } from "./lib/metered-stream";
export { getRun, listRuns, startRun } from "./lib/runs";
// "Try it": a spec on one message, in memory, with every write stubbed. Nothing is stored.
export { dryRun } from "./lib/dry-run";
export { recentMessages } from "./lib/recent-messages";
// For the builder's read_examples: a Gmail search and each message's fields, held in memory by
// the caller (invariant 8).
export { readMessage, searchMessages } from "./lib/gmail";
// Called by the triggers' fan-out jobs and tests, as the org's system ctx: the runs one new
// inbound message, or one new invite, starts.
export { startInviteRuns, startTriggeredRuns } from "./lib/trigger";
// The Calendar trigger: polling one connection's calendar for new invites, as the org's system
// ctx, and, called only by its cron (which has no ctx until it picks an org, ADR-0009), which
// connections are due a poll.
export { pollCalendar } from "./lib/calendar-poll";
export { calendarsDue } from "./lib/calendar-due";
