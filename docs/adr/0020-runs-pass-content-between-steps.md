# Runs pass content between steps

Replaces ADR-0012. A step may hand later steps anything it read or wrote, email bodies and generated text included, for every action, our catalog's and custom ones alike. Workflows that read once and use the text in several steps no longer re-fetch it in each, and a step's state is there for any later step that needs it. Inngest stores what passes between steps for its retention period (24 hours on its Free plan, 7 days on Pro), and it can't delete one run's data on demand. We encrypt it with Inngest's encryption middleware, under one app key held in a KMS, because Google's restricted-scope rules (updated 2026-09-03) require user data encrypted at rest with managed keys and its yearly assessment tests every place data is stored; Inngest's dashboard then shows only ciphertext. We accept that content ages out of Inngest on that schedule rather than being deleted the moment its connection is, and chose one app key over a key per connection.

## Consequences

- Invariant 8 now holds for Mycel's own database only. Our run records (`run_steps`) still keep no content: what passed between steps is never shown in a run's history, trace or any admin view, only its kind and size, so ADR-0001 still holds. A tool step's result is no longer copied into its run record as it is.
- Invariant 3 holds for our database at once and for Inngest when its retention ends.
- Content still never goes into discovery's derived data or memory except through their own rules.
