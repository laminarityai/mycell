# Specs run on our own interpreter, one Inngest step per spec step, not on Mastra

Workflow specs are executed by a small interpreter in `features/runtime` that runs each spec step as its own Inngest step; the builder chat uses the Vercel AI SDK directly, and run traces go in our own `runs` / `run_steps` tables. The original plan compiled specs to Mastra dynamic workflows, but those can run only on Mastra's own engines, not on Inngest, so a whole run would be one opaque Inngest step: a retry after a late failure would re-run earlier steps and create duplicate Gmail drafts, and we would run two engines with two retry systems, two run-state stores, and two trace stores. Mastra's dynamic-workflow API was also Beta (added August 2026, breaking changes allowed in minor releases) and new enough that coding agents don't know it.

## Consequences

- We give up Mastra's graph engine (parallel branches, loops, nested workflows), its trace storage, and Studio. v1's specs are short linear step lists with a stop branch, so none of that is needed yet.
- Branch conditions are structured data (`{ "step": "classify", "label": "yes", "minP": 0.85 }`) rather than expression strings, so the interpreter needs no expression parser. Settled in M3 (#34); see `docs/architecture.md`, "Workflow spec".
- The spec is the contract (invariant 5), so the executor is replaceable: switching to Mastra or another engine later, e.g. for rung-5 multi-person workflows, stays inside `features/runtime`.
