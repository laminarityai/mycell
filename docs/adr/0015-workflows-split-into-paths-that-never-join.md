# Workflows split into paths at branches, and the paths never join

A workflow used to be one line of steps, where a branch could only let the run go on or stop it. Admins need real forks, above all to decide what goes to a person and what Mycel handles alone, so a **branch** now splits a workflow into **paths**. Each path has a condition, and every branch has an **otherwise path** that runs when no other path applies and stops the run unless it has steps. A condition tests a classify answer (with a minimum confidence), an extracted value, a fact about the trigger, or a field a catalog action returns, using typed checks combined with all-of or any-of one level deep. Every trigger, extract step and catalog action declares the fields a condition may test, so a new app brings its own. Each branch picks **first match** (paths checked left to right, the first that holds runs; the default) or **every match** (every path that holds runs, one after another, left to right). Paths never join back up: a step may use anything above it on its own path, and a step that two paths both need is repeated on each. We store paths nested inside their branch, so "steps after the branch" can be added later without converting every workflow again. Branches nest at most 3 deep, with at most 10 paths each. A branch chooses a path but never removes a review: the policy engine still adds one wherever the catalog requires it (invariant 4). Specs from before this change are converted when read, and published versions keep running as they did.

## Considered options

- One line of steps, branches that only stop or escalate: simplest, but it can't route different messages to different actions.
- Paths that join, as Make, n8n, Power Automate and Zapier's newer editor allow: no repeated steps, but every step after a join needs a rule for data that only some paths produced. Deferred until a real workflow needs it; Relay.app's rule (usable after the join only if every path produced it) is the model to start from.
- Running every-match paths at the same time, as Power Automate does: faster, but results would arrive in no fixed order, and Try it would be harder to read. Email workflows don't need the speed.

## Consequences

- Validation refuses two paths that can run together under every match and both draft a reply in the same thread, or both escalate.
- When one path fails, the others go on, and the run ends as partly failed.
- Shared closing steps, such as labelling the message, are repeated on each path until joins arrive.
