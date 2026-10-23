// The pending-form adapters (ADR-0013): for each pending form, the only code that carries out,
// removes, checks or shows what a run left waiting in its app. The `reviews` feature calls them,
// chosen by a review's kind. This entry file stays clear of `reviews`, which the interpreter
// imports to create reviews, so the two features' files never import each other in a cycle.
export { escalationAdapter } from "./lib/escalation-adapter";
export { gmailDraftAdapter } from "./lib/gmail-draft-adapter";
export { heldSendAdapter } from "./lib/held-send-adapter";
export { suggestedEditsAdapter } from "./lib/suggested-edits-adapter";
export {
  type HeldSendField,
  type ItemState,
  type ItemView,
  type MailView,
  type PendingFormAdapter,
  type PendingItem,
  type PreparedItem,
  type ReviewEdits,
  type SuggestedEditsView,
} from "./lib/pending-forms";
