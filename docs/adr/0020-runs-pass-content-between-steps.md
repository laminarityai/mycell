# Runs pass content between steps

Replaces ADR-0012. A step may hand later steps anything it read or wrote, email bodies and generated text included, for every action, our catalog's and custom ones alike. Workflows that read once and use the text in several steps no longer re-fetch it in each, and a step's state is there for any later step that needs it. Inngest stores what passes between steps for its retention period (24 hours on its Free plan, 7 days on Pro), unencrypted, where anyone with access to our Inngest account can query it, and it can't delete one run's data on demand. We accept both, including that content ages out of Inngest on that schedule rather than being deleted the moment its connection is.

## Consequences

- Invariant 8 now holds for Mycel's own database only. Our run records (`run_steps`) still keep no content: what passed between steps is never shown in a run's history, trace or any admin view, only its kind and size, so ADR-0001 still holds. A tool step's result is no longer copied into its run record as it is.
- Invariant 3 holds for our database at once and for Inngest when its retention ends.
- Content still never goes into discovery's derived data or memory except through their own rules.
