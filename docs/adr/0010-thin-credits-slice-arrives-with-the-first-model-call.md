# A thin credits slice arrives with the first model call, in M3

Invariant 7 says every model call checks credits first and records its usage, but the credits milestone (M7) comes after M3, M6, M5, M2 and M4, all of which call models. Rather than waive the invariant until M7 or move M7 forward, M3 builds a thin `credits` feature: a ledger, a balance, a pre-flight check that throws `OutOfCreditsError`, usage recorded from the AI Gateway's reported cost, and a script that grants credits to an org. Every later model call is then compliant from the day it is written, instead of being retrofitted.

## Consequences

- M7 keeps everything beyond that: budgets, pausing a workflow or org when credits run out, admin emails, discovery cost estimates, and real pricing. Until then a run that runs out of credits simply fails.
- The ratio of credits to gateway cost is a placeholder in config until M7 sets pricing.
