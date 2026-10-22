# Docs reviews are approved or declined in Mycel, like every other review

Replaces the Docs part of ADR-0013. ADR-0013 said a Docs review could only say "open the doc", because Google offered no way for us to accept suggestions. On 2026-09-30 the Docs API made suggestions generally available: `documents.batchUpdate` with `writeControl.writeMode: SUGGEST` writes edits as suggestions and returns their IDs, and `AcceptSuggestionRequest` and `RejectSuggestionRequest` act on them. So a Docs review now works like Gmail's and Calendar's: approving accepts the suggestions the step made, and declining rejects them. "Open the doc" stays as a link for anyone who wants to accept some and reject others in Docs itself. We chose this over keeping Docs the one app approved elsewhere, which left a member's work in Docs outside the one place ADR-0013 promises them.

## Consequences

- Mycel writes through the person's own Google connection, so the suggestions carry that person's name, not Mycel's. The review keeps the IDs Google returned, and those IDs are how Mycel tells its suggestions from the person's own. They're pointers, not content (invariant 8).
- Approve and decline act on all of the step's suggestions together. Picking among them happens in Docs, and the review ends as "done in the app" once none of its suggestions remain.
- Accepting needs edit access to the doc. When the person can't edit it, the review offers the link alone, and the doc's editors accept or reject in Docs.
