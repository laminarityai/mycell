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
// For the builder's read_examples: a Gmail search and each message's fields, held in memory by
// the caller (invariant 8).
export { readMessage, searchMessages } from "./lib/gmail";
// Called by the trigger's fan-out job and tests, as the org's system ctx: the runs one new
// inbound message starts.
export { startTriggeredRuns } from "./lib/trigger";
