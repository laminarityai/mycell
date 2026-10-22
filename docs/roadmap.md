# Mycel roadmap (v1)

Build order for the v1 full loop, dogfooded on our own Google Workspace. Every milestone ends with something we can actually use ourselves. `docs/architecture.md` holds the architecture and invariants. This file only covers sequencing.

The builder chat is primary (ADR-0007), so it comes before mining. Milestones keep their numbers as stable names and are listed in build order: **M0 → M1 → M3 → M6 → M12 → M5 → M11 → M13 → M14 → M7 → M8 → M9 → M2 → M4 → M10.**

## Status (2026-10-21)

| Milestone | State       | Spec | Notes                                                                                                                                                                       |
| --------- | ----------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0        | Done        | #1   |                                                                                                                                                                             |
| M1        | In progress | #11  | Merged: connect, org connections, disconnect cascade, Gmail backfill. Open: polling #15, reconciliation #16 (PR #31), Drive #17, dogfood #19.                               |
| M3        | Ready       | #33  | Grilled; tickets ready for agents. Decisions in ADR-0010 (credits slice), ADR-0011 (write access up front), ADR-0012 (what runs keep) and ADR-0014 (one Google connection). |
| M6        | Ready       | #43  | Grilled; tickets ready for agents. Capability requests moved to M10.                                                                                                        |
| M12       | Grilling    |      | Branches and the workflow graph. Decisions in ADR-0015 (paths that never join); research in `docs/research/workflow-builders.md`.                                           |
| M5        | Done        | #51  | Publish, tags, member toggles and the Reviews page (PR #89). Open: dogfood check #57.                                                                                       |
| M11       | Ready       | #67  | Calendar, Docs and Tasks, each through its pending form (ADR-0013); tickets ready for agents.                                                                               |
| M13       | Ready       | #91  | Custom actions made by the builder chat. Decisions in ADR-0017 to ADR-0020; research in `docs/research/integrations/`. Tickets to cut.                                      |
| M14       | Ready       | #92  | Memory foundation. Decisions in ADR-0021 to ADR-0024; research in `docs/research/memory-layer.md`. Tickets to cut.                                                          |
| M7 onward | Not started |      | Build order after M14: M7, M8, M9 (the agent), then M2 (discovery) and M4, then M10.                                                                                        |

## M0: Scaffold and tenancy

- **First commit:** the docs, plus an empty app skeleton with every tool wired and proven to bite. `pnpm verify` passes, a deliberate bad import fails the boundary check, the GitHub Actions workflow calls `pnpm verify`, the Husky hooks are in place, and `CLAUDE.md` is a symlink to `AGENTS.md`. No product features.
- pnpm workspace (`app/` + `nango-integrations/`), Next.js app, Drizzle + Neon, Better Auth, Inngest.
- Auth, orgs, users, roles (admin/member), tags.
- Tenant-scoped query helpers; the `org_id` invariant enforced in code review and tests.
- **Done when:** two test orgs exist and isolation tests prove neither can read the other's rows.

## Alongside M1: the discovery-lens experiment

- Blind lists from everyone, a minimal synthetic generator seeded from them, and both lenses run in `experiments/discovery-lenses/` (`docs/research/discovery-multi-app.md`).
- It doesn't block any milestone, and no longer gates objects: ADR-0021 replaced that gate. M2's synthetic generator measures discovery instead.

## M1: Connect and ingest

- Nango Cloud + an Internal Google OAuth app. Connect Gmail and Sheets/Drive (member and org connections).
- 90-day backfill, then incremental updates. Normalize to the event schema, with `object_refs` filled by deterministic links only (ADR-0008); keep derived data and pointers only.
- Connection-deleted webhook → cascade delete.
- **Done when:** our mailboxes are ingested and disconnecting removes everything for that connection.

## M3: Spec, policy, runtime

- Zod spec schema, validator, policy engine with the action risk catalog, interpreter that runs each spec step as an Inngest step (ADR-0006).
- Optional per-step `checks` (output schema, confidence floor, required fields), with failures recorded for observability.
- Catalog v1: Gmail create-draft, add-label, read message/thread; Sheets read-range, append-row.
- One Google connection per account, asking for every Google app at once, with write access (ADR-0011, ADR-0014).
- AI Gateway with model roles; Jev for `classify`.
- **Done when:** a hand-written spec runs end to end on a real inbox and produces drafts and labels.

## M6: Builder chat

- Admin agent producing proposals in builder conversations, grounded in the admin's own and org inboxes; a "try it" dry run; visual/JSON editor.
- **Done when:** an admin can describe a new workflow and publish it without touching JSON.

## M12: Branches and the workflow graph

- Branches split a workflow into paths, each with a condition, plus an otherwise path; first match or every match per branch; no joins yet (ADR-0015).
- Conditions test classify answers, extracted values, trigger facts and catalog action results, through fields each of them declares.
- A graph of the workflow, laid out automatically top to bottom: click a step to edit it in a side panel, "+" to add one. It sits beside the builder chat, shows waiting proposals as changes on the graph, and lights up the paths Try it took. On the workflow page it replaces the step form; the JSON view stays.
- Admins only; members' read-only view is a candidate for M5.
- **Done when:** an admin describes a workflow that sends some messages to a person and handles others alone, accepts it on the graph, and Try it shows which path each message took.

## Later workflow features

Planned in this order, each its own milestone or part of one, after M12:

1. Wait, then check again ("wait 3 days; if no reply, draft a follow-up").
2. Scheduled triggers ("every Monday at 9").
3. More triggers: a new sheet row, a new calendar invite (M11).
4. A path for when a step fails.
5. Doing something for each item in a list.
6. Asking a person and continuing with their answer (after M5's Reviews page).
7. Joins and reusable sub-workflows: deliberately not yet (ADR-0015).

## M5: Publish, tags, member toggles

- Admin publishes to tags; members enable/disable; member vs. org credentials.
- Versioning with auto-upgrade and the re-enable exception.
- The Reviews page: a member's main screen, holding every step that needs a person (ADR-0013). Accept, decline, edit, and hand-off where the workflow allows it; a review count and a daily digest email.
- Record how each review ends; this measures the builder ship bar.
- **Done when:** a teammate enables a workflow on their own inbox without our help.

## M11: Calendar, Docs and Tasks

- Catalog actions for Calendar (create an event, with guests added on approval), Docs (suggested edits) and Tasks (add or change a task on the person's own list), each through its pending form (ADR-0013).
- A Calendar trigger: a new invite on the person's calendar.
- No new connection: the one Google connection already asks for them (ADR-0014). Mining them stays gated by ADR-0008.
- **Done when:** a workflow that reads an email and books a meeting runs on one of our inboxes, and its guests are invited only after approval.

## M13: Custom actions

- When no catalog action fits, the builder chat describes one call to a registered app as a custom action of the org, with its risk set by a fixed rule; anything but a read waits for a person every time (ADR-0017, ADR-0018).
- Where an app can't hold a waiting send, Mycel holds it until its review ends (ADR-0019).
- Capability requests (moved from M10): code the builder drafts, reviewed by our team into the catalog.
- Our team registers apps in `docs/research/integrations/ranking.md`'s order.
- **To revisit:** letting admins connect a vendor's MCP server by its address alone, once those servers leave preview and their terms allow apps like ours.
- **Done when:** an admin describes a workflow in an app with no catalog actions, and it runs with each of its writes approved on the Reviews page.

## M14: Memory foundation

- Objects, links and facts built from Gmail, Drive docs and Calendar, in Postgres with pgvector: facts and pointers only, stated facts only, business items only within a monthly extraction budget (ADR-0021).
- Each source record keeps its app's access list; a fact is visible to anyone who can see one of its sources; company-wide lists and org connections (ADR-0022). Admin exclusions.
- Retention (with its source, at most 24 months), forget a person and the do-not-learn list, an access log of every read, a key per company in a KMS (ADR-0023). Slack and similar apps are searched live (ADR-0024).
- Memory feeds workflows and the builder chat's context.
- **Done when:** a workflow on one of our inboxes uses a fact about a customer drawn from another source its member can see, a member never sees a fact from a source they can't, and forgetting a person removes every trace of them from memory.

## M7: Credits and budgets

- Hard stop, per-workflow budgets, discovery cost estimate, real pricing. The ledger and pre-flight check already arrive in M3 (ADR-0010).

## M8: Observability and failure handling

- Admin runs/traces view, retries, auto-pause after 3 consecutive failures, admin email, member "paused" badge.

## M9: The agent

- A Mycel agent in each person's own view of memory (ADR-0022): it reads memory, acts only through workflows and the Reviews page, and turns "remember this" into a fact owned by that person. **To grill when scoping M9.**

## M2: Mining and suggestions

- **Entry task:** the eval-grade synthetic company generator (planted workflows and decoys), to measure discovery's recall and precision.
- Embeddings, clustering, cluster labeling, template detection, request→response pairs, built on M14's objects (ADR-0021).
- Ranking, rung mapping, a suggestions UI with evidence (re-fetched via the proxy; visibility per ADR-0001). Suggestions and mined patterns feed the builder chat's context.
- Nightly incremental mining; the dismissed-suggestion resurfacing rule.
- Mine our own run logs (runs, approvals, edits, overrides) as a discovery source.
- **Done when:** at least 3 of the top 5 suggestions on our own data are rated real and worth automating.

## M4: Shadow eval

- Replay specs on held-out past cases; judge plus edit distance; show the results on suggestions.
- Compare `classify` models on our own mail, e.g. Jev against Laya (`convaiinnovations/laya`), before changing an org's role table.
- **Done when:** every suggestion shows "would have handled X of Y correctly".

## M10: External readiness (first outside customer)

- Google OAuth verification and the restricted-scope security assessment.
- Outlook and the rest of Microsoft, and Slack once it has a pending form, through the same four parts (ADR-0013).
- Onboarding flow tuned for non-technical admins.
- Revisit admin-level data access if a customer needs it (ADR-0008).

## After M10: Memory over MCP

- An MCP server giving each person's own view of memory to other AI tools, with the same access log and prompt-injection screening (ADR-0022, ADR-0023). **To grill when scoping:** how clients sign in and which tools it offers.
