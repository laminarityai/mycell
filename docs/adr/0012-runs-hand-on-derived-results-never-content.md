# Runs pass derived results between steps, never content

Inngest saves each step's result so a run can resume after a crash, which means anything one step hands to the next is stored on Inngest's servers for its retention period. We treat that as persistence under invariant 8. Email bodies and subjects, sheet contents, and the reply text a model writes never cross a step boundary: a `draft` step reads the email, writes the reply and creates the Gmail draft inside one step. Steps may hand on derived results (labels, confidence, IDs, and the fields an `extract` step pulls out), since invariant 8 allows derived data. Our own run records keep less still: which fields were found, never their values. Admins will browse run records (M8), and a value from a member's mailbox would show them that member's mail, which ADR-0001 forbids.

## Consequences

- A step that needs content re-fetches it through the Nango proxy instead of receiving it from an earlier step.
- Company knowledge doesn't belong in run records. It goes into memory (M9), with source refs and promotion rules.
