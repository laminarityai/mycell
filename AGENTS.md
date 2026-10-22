# Mycel

Mycel lets a small company's admins describe supervised AI workflows to a builder chat, and the team switches them on. Discovery mines Gmail and Sheets for repetitive work to suggest workflows and give the builder context. v1 is dogfooded on our own Google Workspace.

## Verify

`pnpm verify` is the whole CI: format check, lint, typecheck, import boundaries, tests, build, e2e tests. Work is done when it passes locally and in CI; the pre-push hook runs it locally, and GitHub Actions runs it on every push and pull request.

Other commands: the `package.json` scripts.

## Invariants

Every change keeps all eight true.

1. **Tenancy.** Every tenant-owned table has `org_id`, and every query runs through `forOrg(ctx)` from `src/db`.
2. **Provenance and scope.** Every ingested or derived record carries `org_id`, `connection_id`, `source_ref`, and `owner_scope` (`member` | `org`). Member-scoped data reaches other people only through its source's own access list, a list an admin marked company-wide, or an org connection (ADR-0023).
3. **Deletion.** Deleting a connection deletes everything with its `connection_id`, embeddings and facts included, whether the deletion comes from the user, Nango's webhook, or the nightly reconciliation. Content a run passed between steps ages out of Inngest instead (ADR-0021).
4. **Deterministic risk.** The policy engine sets approval requirements from the action catalog's fixed risk levels. A model may propose a risk level; only the catalog decides one, or, for a custom action, a fixed rule over the call it makes (ADR-0018).
5. **Specs, not code.** The builder agent outputs specs that validate against `features/spec` and use catalog actions or the org's custom actions, which describe one call and contain no code. Code the builder drafts runs only after our team reviews it into the catalog (ADR-0018).
6. **Model roles.** Code and specs name roles (`classify`, `fast`, `smart`, `judge`, `embed`). Model IDs live in config and resolve per org at runtime.
7. **Credits first.** Every model call and discovery job passes a pre-flight credit check and records its usage in the ledger.
8. **Pointers, not content.** Our database keeps derived data plus `source_ref`, never raw email or file content, and re-fetches content through the Nango proxy. Memory holds facts and pointers, never source text (ADR-0022). Two exceptions: a run may pass content between its steps, which Inngest stores encrypted until its retention ends (ADR-0021), and Mycel holds a waiting send that its app can't hold, encrypted, until its review ends (ADR-0020).

## Writing code

- Each feature lives in one directory, `app/src/features/<name>/`. Import another feature only through its root entry files.
- Server-side functions take `ctx` (org, user, role) as their first argument.
- Reads: Server Components call `server.ts` functions. Writes: Server Actions. Route handlers serve only webhooks, Inngest, and streaming.
- A list read makes the same number of queries for 1 row or 100: batch it, and pin hot reads with a query-budget test.
- Parse every IO boundary with Zod.
- Errors: throw the typed error classes, and turn them into messages at the Server Action or route boundary.
- Server Actions go through `runFormAction` from `orgs/form-action.ts`, and only write.
- Show dates with `<DateTime>`; the server's time zone isn't the reader's.
- UI: Tailwind and shadcn/ui components.
- Tests: Vitest, against real Postgres in Docker.
- Names: glossary terms, `kebab-case` files, named exports.

## Read before

- **Writing or moving code**: `docs/conventions.md` (feature-directory shape, data access, migrations, config, tooling, naming).
- **Naming anything**: `GLOSSARY.md`.
- **Touching a subsystem** (data handling, discovery, spec, policy, runtime, credits, memory): `docs/architecture.md`.
- **Reversing or questioning a decision**: `docs/adr/`.
- **Scoping work or cutting it**: `docs/intent.md` and ADR-0007 (builder primary).
- **Choosing what to build next**: `docs/roadmap.md`.

## Agent skills

### Issue tracker

GitHub Issues on `laminarityai/mycell`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
