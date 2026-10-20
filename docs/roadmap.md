# Mycel roadmap (v1)

Build order for the v1 full loop, dogfooded on our own Google Workspace. Every milestone ends with something we can actually use ourselves. `docs/architecture.md` holds the architecture and invariants. This file only covers sequencing.

The builder chat is primary (ADR-0007), so it comes before mining. Milestones keep their numbers as stable names and are listed in build order: **M0 → M1 → M3 → M6 → M5 → M2 → M4 → M7 → M8 → M9 → M10.**

## Status (2026-10-20)

| Milestone | State       | Spec | Notes                                                                                                                                         |
| --------- | ----------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| M0        | Done        | #1   |                                                                                                                                               |
| M1        | In progress | #11  | Merged: connect, org connections, disconnect cascade, Gmail backfill. Open: polling #15, reconciliation #16 (PR #31), Drive #17, dogfood #19. |
| M3        | Ready       | #33  | Grilled; tickets ready for agents. Decisions in ADR-0010 (credits slice), ADR-0011 (write access up front) and ADR-0012 (what runs keep).     |
| M6        | Specced     | #43  | Needs triage.                                                                                                                                 |
| M5        | Specced     | #51  | Needs triage. Adds draft-outcome tracking, the measurement for the builder ship bar in `docs/intent.md`.                                      |
| M2 onward | Not started |      |                                                                                                                                               |

## M0: Scaffold and tenancy

- **First commit:** the docs, plus an empty app skeleton with every tool wired and proven to bite. `pnpm verify` passes, a deliberate bad import fails the boundary check, the GitHub Actions workflow calls `pnpm verify`, the Husky hooks are in place, and `CLAUDE.md` is a symlink to `AGENTS.md`. No product features.
- pnpm workspace (`app/` + `nango-integrations/`), Next.js app, Drizzle + Neon, Better Auth, Inngest.
- Auth, orgs, users, roles (admin/member), tags.
- Tenant-scoped query helpers; the `org_id` invariant enforced in code review and tests.
- **Done when:** two test orgs exist and isolation tests prove neither can read the other's rows.

## Alongside M1: the discovery-lens experiment

- Blind lists from everyone, a minimal synthetic generator seeded from them, and both lenses run in `experiments/discovery-lenses/` (`docs/research/discovery-multi-app.md`).
- It doesn't block any milestone. A new ADR records its result against ADR-0008's decision rule.

## M1: Connect and ingest

- Nango Cloud + an Internal Google OAuth app. Connect Gmail and Sheets/Drive (member and org connections).
- 90-day backfill, then incremental updates. Normalize to the event schema, with `object_refs` filled by deterministic links only (ADR-0008); keep derived data and pointers only.
- Connection-deleted webhook → cascade delete.
- **Done when:** our mailboxes are ingested and disconnecting removes everything for that connection.

## M3: Spec, policy, runtime

- Zod spec schema, validator, policy engine with the action risk catalog, interpreter that runs each spec step as an Inngest step (ADR-0006).
- Optional per-step `checks` (output schema, confidence floor, required fields), with failures recorded for observability.
- Catalog v1: Gmail create-draft, add-label, read message/thread; Sheets read-range, append-row.
- AI Gateway with model roles; Jev for `classify`.
- **Done when:** a hand-written spec runs end to end on a real inbox and produces drafts and labels.

## M6: Builder chat

- Admin agent producing spec diffs; visual/JSON editor; capability-request queue.
- **Done when:** an admin can describe a new workflow and publish it without touching JSON.

## M5: Publish, tags, member toggles

- Admin publishes to tags; members enable/disable; member vs. org credentials.
- Versioning with auto-upgrade and the re-enable exception.
- **Done when:** a teammate enables a workflow on their own inbox without our help.

## M2: Mining and suggestions

- **Entry task:** the eval-grade synthetic company generator (planted workflows and decoys), to measure discovery's recall and precision.
- Embeddings, clustering, cluster labeling, template detection, request→response pairs.
- Ranking, rung mapping, a suggestions UI with evidence (re-fetched via the proxy; visibility per ADR-0001). Suggestions and mined patterns feed the builder chat's context.
- **Done when:** at least 3 of the top 5 suggestions on our own data are rated real and worth automating.

## M4: Shadow eval

- Replay specs on held-out past cases; judge plus edit distance; show the results on suggestions.
- Compare `classify` models on our own mail, e.g. Jev against Laya (`convaiinnovations/laya`), before changing an org's role table.
- **Done when:** every suggestion shows "would have handled X of Y correctly".

## M7: Credits and budgets

- Hard stop, per-workflow budgets, discovery cost estimate, real pricing. The ledger and pre-flight check already arrive in M3 (ADR-0010).

## M8: Observability and failure handling

- Admin runs/traces view, retries, auto-pause after 3 consecutive failures, admin email, member "paused" badge.

## M9: Continuous discovery and memory

- Nightly incremental mining; the dismissed-suggestion resurfacing rule.
- Mine our own run logs (runs, approvals, edits, overrides) as a discovery source.
- Memory extraction, dedupe/supersede, promotion; org memories added to builder chat context.
- **To scope when grilling M9:** a company agent that draws on org memory. Settle what it can see and do (especially around member-scoped data) before building; `docs/intent.md` non-goal 5 rules out a personal agent for v1.

## M10: External readiness (first outside customer)

- Google OAuth verification and the restricted-scope security assessment.
- Outlook connector behind the same interface.
- Onboarding flow tuned for non-technical admins.
- Revisit admin-level data access if a customer needs it (ADR-0008).
