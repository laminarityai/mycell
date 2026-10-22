# A person approves anything said in someone's name; changing records runs on its own

`docs/intent.md` said nothing may leave the company without a person approving it, and `docs/architecture.md` said anything that reaches other people waits. Gmail never forced a choice, but most other apps do: a comment, an assignment or a Slack message reaches coworkers without leaving the company. We drew the line at words: a person approves anything Mycel says in someone's name (an email, a message, a comment, an invitation), whoever reads it. Changing records (a task's status, an assignment, a CRM field, a label) runs on its own, even when the app tells coworkers about the change. People care about approving what is said for them; record changes are reversible, and making each one wait would bury people in reviews. We chose this over "leaves the company", which lets Mycel post in a person's name to their whole team unseen, and over "reaches anyone", which makes nearly every write in a shared tool wait.

## Consequences

- Our team sets each catalog action's level by this line. A fixed rule can't apply it to an arbitrary call, so every custom write waits (ADR-0018).
