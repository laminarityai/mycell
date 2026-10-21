// Acting on someone else's connection on behalf of a review (ADR-0016). Only `reviews` may
// import this (.dependency-cruiser.cjs): it calls it after its own check that the caller may act
// on the review, so a colleague sends a handed-on draft from the owner's mailbox, and a tagged
// member one waiting in a shared inbox.
export { delegatedCtx } from "./lib/delegation";
