// The pending-form adapters (ADR-0013): for each pending form, the only code that carries out,
// removes, checks or shows what a run left waiting in its app. The `reviews` feature calls them,
// chosen by a review's kind. This entry file stays clear of `reviews`, which the interpreter
// imports to create reviews, so the two features' files never import each other in a cycle.
export { escalationAdapter } from "./lib/escalation-adapter";
export { gmailDraftAdapter } from "./lib/gmail-draft-adapter";
export {
  type ItemState,
  type ItemView,
  type MailView,
  type PendingFormAdapter,
  type PendingItem,
  type PreparedItem,
  type ReviewEdits,
} from "./lib/pending-forms";
