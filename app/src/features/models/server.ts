// The models feature: every model call, through the AI Gateway. A call names a model role, which
// resolves to the org's model (invariant 6), passes the credit check before anything is sent,
// and records one usage entry in the ledger (invariant 7). runtime, builder and memory call
// models through here.
import "server-only";
export { callModel, CREDIT_ESTIMATES } from "./lib/call-model";
export { classify } from "./lib/classify";
export { embed } from "./lib/embed";
// Screens fetched text for prompt injection before a model reads it, metered the same way.
export { estimateScreenCredits, screenForInjection } from "./lib/injection-screen";
export { CONTEXT_WINDOWS, resolveModel, setModelRole } from "./lib/model-roles";
// For callers that stream a model themselves: the role's model, behind the credit check, and
// its one usage entry when the stream ends.
export { openMeteredStream } from "./lib/metered-stream";
// A chat's metered turn (the builder chat's, and any other chat's): the streamed reply, its
// tools, and its stored messages read back for the model and the chat page.
export { streamChatTurn, type ChatTurnRequest } from "./lib/chat-turn";
export { chatTool, type ChatTool, type ChatToolDefinition, type ChatTools } from "./lib/chat-tools";
export { chatModelMessages, chatUIPart } from "./lib/chat-history";
// For the failed-call job: a failed call's billed cost, looked up in the gateway, into the ledger.
export { correctFailedCallCost } from "./lib/failed-call-costs";
