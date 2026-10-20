# Object refs are deterministic links; an entity backbone waits for the discovery-lens experiment

Each normalized event's `object_refs` holds only deterministic links to business objects: exact email addresses, IDs, and file references, merged on exact keys. There is no LLM entity pass and no fuzzy matching. An entity backbone (extracting objects from free text, resolving them into canonical objects, and mining each object's lifecycle across apps) could find multi-step, cross-app workflows that message clustering misses. But no study we found shows that it beats single-source analysis, and a link like "an email mentions X, then a sheet row with X appears" never observes the actual copy. So we only build the backbone after v1, and only if the **discovery-lens experiment** (`docs/research/discovery-multi-app.md`) passes this rule, fixed before it runs:

- At least 25% of the tasks on teammates' blind lists are tagged cross-app, **and**
- the entity lens recovers at least max(3, 15% of the list) owner-rated "worth automating" tasks that the message lens misses.

If it passes, production extraction works like this. A `fast`-role LLM proposes free-text spans next to the structured-field and regex candidates. Jev, called through the AI SDK, types each candidate and scores candidate pairs for resolution. GLiNER is not used in production, because it has no mature TypeScript runtime and doesn't fit a Vercel function. A Python service needs a new ADR that supersedes ADR-0004. A new ADR also records the experiment's result.

## Consequences

- Intent non-goal 5 (no full cross-app entity resolution) stays for v1.
- Admin-level data access is out of v1: no Admin SDK Reports API and no domain-wide delegation. Both would observe members' activity at org level, which conflicts with owner scopes and ADR-0001. Only member and org connections exist.
- Calendar and Forms join the sources only if the experiment's blind lists show tasks that need them.
