// The models feature: every model call, through the AI Gateway. A call names a model role, which
// resolves to the org's model (invariant 6), passes the credit check before anything is sent,
// and records one usage entry in the ledger (invariant 7). runtime, builder and memory call
// models through here.
export { callModel, CREDIT_ESTIMATES } from "./lib/call-model";
export { classify } from "./lib/classify";
export { embed } from "./lib/embed";
export { resolveModel, setModelRole } from "./lib/model-roles";
// For callers that stream a model themselves (the builder chat): the role's model, behind the
// credit check, and its one usage entry when the stream ends.
export { openMeteredStream } from "./lib/metered-stream";
