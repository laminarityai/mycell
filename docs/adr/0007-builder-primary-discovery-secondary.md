# The builder chat is primary; discovery suggests workflows and gives the builder context

Admins make workflows mainly by describing them to the builder chat. Discovery runs alongside it: it suggests workflows mined from real data and feeds the builder context about how the org works. We reversed the original "mined, not described" framing for two reasons. Our own Google Workspace holds too little history to prove bottom-up discovery before v1. And top-down building ("describe it, we build it") is proven ground, as Trace shows, while bottom-up discovery is our biggest unknown. Discovery keeps its value even when it surfaces few suggestions, because the builder uses what it learns.

## Consequences

- The v1 success bar is met by a workflow an admin built in the builder chat. Discovery has its own, separate bar (`docs/intent.md`).
- The roadmap builds the builder chat (M6) before mining (M2) and shadow eval (M4).
- Discovery's experiment (ADR-0008) no longer blocks M1.
