# Conventions

The always-on rules live in `AGENTS.md` ("Invariants", "Writing code"). This file holds the detail behind them. Consistency matters more than any single rule: when this file doesn't cover a case, match the code next to it.

## Inside a feature directory

Every `app/src/features/<name>/` has the same shape. Root files are the public entry points (each optional), and subfolders are private. dependency-cruiser makes it a lint error to import a subfolder from outside its feature.

| File         | Exports                                        | Imported by                             |
| ------------ | ---------------------------------------------- | --------------------------------------- |
| `server.ts`  | server-side functions, each taking `ctx` first | Server Components, other features, jobs |
| `actions.ts` | Server Actions (`"use server"`)                | client components                       |
| `ui.tsx`     | the feature's React components                 | pages in `src/app/`                     |
| `jobs.ts`    | the feature's Inngest functions                | the single Inngest route                |
| `types.ts`   | public types and Zod schemas                   | anyone                                  |

- A pure feature (no tables, no IO, no `ctx`, like `spec` and `policy`) has no `server.ts`. Its functions live in root files named for what they hold (`spec/validate.ts`, `policy/catalog.ts`, `policy/engine.ts`), which anyone may import, client code included.
- `server.ts` functions that exist before any `ctx` does (sign-in, resolving the session to `ctx`, the auth route) are the only ones that don't take it first; they live in `orgs`.
- `lib/`: implementation, including `lib/schema.ts` for the feature's tables.
- `tests/`: tests that import only the feature's entry files.
- `tests/isolation-cases.ts`: a case for every function `server.ts` exports, proving it stays inside the caller's org (see "Tests" below).
- **Tables are private to their feature (ADR-0005).** A feature that needs another feature's data calls that feature's `server.ts`, which also exposes any join a screen needs.
- Import from the file that owns the thing. A directory has no `index.ts` re-exporting it.

`src/app/` holds routes only (pages, layouts, route handlers), kept thin: they call features. `src/db/` holds the Drizzle client, migrations, `forOrg(ctx)`, Better Auth's generated schema (`auth-schema.ts`), and the shared test fixtures in `testing/`, and no feature tables. `src/components/ui/` holds shadcn/ui components, `src/lib/` holds shared helpers that belong to no feature, and `src/testing/` holds test fakes of external services (the fake Nango). To start a feature, copy the shape of an existing one, but not the data access of `orgs`, which is the one feature that skips `forOrg` (see below).

## Data access and config

- **Tenant data (ADR-0003):** feature code queries through `forOrg(ctx)`, which always filters by `org_id` and sets it on inserts from `ctx`, never from caller input. A tenant table names its column `orgId` (`org_id` in SQL). Importing the raw Drizzle client outside `src/db/` is a lint error. There is no Postgres RLS. Better Auth's tables are the one exception: they key the org as `organization_id`, aren't reached through `forOrg`, and only the `orgs` feature touches them. Lint lets `src/features/orgs/lib/` import the raw client and `@/db/auth-schema`, and nothing else outside `src/db/`. The one other exception: a feature's `lib/schema.ts` may import `@/db/auth-schema` so its foreign keys can reference a member as `(org_id, user_id)`, which keeps the row in the member's org and deletes it when the member is removed.
- **Derived data cascades from its connection (invariant 3):** every table holding data ingested or derived from a connection (events, object refs, embeddings, facts, clusters, …) carries `org_id` and `connection_id`, with a composite foreign key `(org_id, connection_id)` to `connections (org_id, id)` (the `connections_org_id_id_unique` key) `ON DELETE CASCADE`. Deleting the connection row then deletes everything derived from it, whichever path deleted it (disconnect, Nango's deletion webhook, reconciliation, removing a user), and a job still writing for a deleted connection fails on the foreign key instead of leaving orphans. Tables are private to their feature, so this is the one exception: a feature's `lib/schema.ts` may import `connections`' `lib/schema.ts` (or another feature's schema) for its foreign keys, and nothing else may (dependency-cruiser's `schemas-only-from-schemas` rule). `discovery`'s events and object refs are the first. A job treats that foreign-key violation, like `NotFoundError` from `connections`, as "the connection is gone" and stops quietly. Never delete derived rows by hand on disconnect: the cascade is the one mechanism.
- **Request context:** `ctx` is passed explicitly. There is no AsyncLocalStorage or other hidden request state.
- **Server boundary:** reads and writes go through Server Components and Server Actions. Add tRPC, a REST layer, or a client-side data cache only when a real need appears, and record it as an ADR.
- **Local database:** `pnpm db:up` starts Postgres with pgvector in Docker on port 5433 (`pnpm db:down` stops it). Copy `app/.env.example` to `app/.env`. Install the browser the e2e tests drive once with `pnpm --filter app exec playwright install chromium`. Tests never use the database in `.env`: each checkout (worktree) gets its own `mycel_test_<suffix>` for Vitest, `mycel_e2e_<suffix>` for Playwright, and an e2e port in 3100–3999, where `<suffix>` is the first 8 hex digits of the sha256 of the checkout's `app/` path (`app/checkout-isolation.ts`). Two worktrees can then run `pnpm verify` at once. `TEST_DATABASE_URL`, `E2E_DATABASE_URL` and `E2E_PORT` override them, for example when two checkouts' ports happen to collide. A removed worktree leaves its databases behind; list them with `docker compose exec postgres psql -U mycel -d mycel -c '\l mycel_*'` and drop one with `docker compose exec postgres dropdb -U mycel mycel_test_<suffix>`.
- **Migrations:** `pnpm db:generate` (`drizzle-kit generate`) writes SQL files to `src/db/migrations/`, which are committed and applied with `pnpm db:migrate` (`drizzle-kit migrate`). Every schema change goes through a reviewed migration file; `drizzle-kit push` is not used. SQL Drizzle can't express (extensions) goes in a `drizzle-kit generate --custom` migration.
- **Config:** environment variables are parsed once by a Zod schema in `src/env.ts`, and everything else imports from there. Reading `process.env` elsewhere is a lint error.
- **Errors:** a small set of typed error classes (`NotFoundError`, `ForbiddenError`, `OutOfCreditsError`, …) is thrown and caught at the Server Action or route boundary. Plain `throw`, no Result/Either types, no Effect.

## UI

Tailwind plus shadcn/ui, with component source copied into the repo. shadcn/ui is built on Radix primitives, so new Radix pieces arrive as shadcn components, keeping one component library.

## Tooling

- **TypeScript:** strict. Typed values at every feature boundary; Zod at every IO boundary.
- **ESLint:** typescript-eslint `strict-type-checked`, plus the Next.js config. It catches bugs and never formats. `max-lines` caps files at 300 lines, and `import/no-default-export` enforces named exports outside the Next.js special files.
- **Version pins:** ESLint stays on 9 and TypeScript on 6.0 until `eslint-config-next`'s plugins support ESLint 10 and typescript-eslint supports TypeScript 7.
- **Prettier:** the only formatter.
- **Tests:** Vitest. Database tests run against real Postgres with pgvector (Docker locally, a service container in CI), in a separate `mycel_test_<suffix>` database per checkout (see "Local database") that the test run creates and migrates. Each test file starts from an empty database, so files run one at a time.
- **End-to-end tests:** Playwright, Chromium only, in `app/e2e/`. They drive the production build through `next start` on the checkout's e2e port (so `pnpm verify` runs them after `pnpm build`; run `pnpm build` before a standalone `pnpm e2e`) against a separate `mycel_e2e_<suffix>` database that Playwright's global setup creates and migrates. Each test that takes the `orgs` fixture starts from an empty database seeded with `seedTwoOrgs()`, and tests run one at a time. Sign-in is Google-only, so `signInAs(user)` stores a Better Auth session and sets its signed session cookie on the browser (`e2e/sign-in-as.ts`); production code has no test login route. Keep them few and about user-visible behavior through the UI; logic belongs in Vitest.
- **External services in tests:** tests never reach the network. `src/testing/fake-nango.ts` is an in-memory Nango Cloud (connect sessions, connections and their paged listing, the proxy to each source's API, and signed webhooks) behind msw's fetch interception, installed for every Vitest file, so tests run the real Nango client. A request it doesn't handle fails the test: extend the fake with the endpoint, in the shape Nango documents, rather than mocking the client. Each connection in the fake has a Gmail mailbox (`src/testing/fake-gmail.ts`) and a Google Drive (`src/testing/fake-drive.ts`) that tests seed, and the scopes Google granted it (every app Mycel asks for unless a test unticks some), which Nango's connection read reports as `credentials.raw.scope`. The proxy (`src/testing/fake-nango-proxy.ts`) routes each request by its `Base-Url-Override` host (or the integration's own) and path prefix to that API's fake, which answers 403, as Google does, unless the connection holds a scope it accepts (`src/testing/fake-proxied-sources.ts`; a host it doesn't know fails the test). Every feature's tests connect through the real flow with `src/testing/connect-helpers.ts` (`connectGoogle`, and `connectOldConnection` for the one-app connections from before ADR-0014). The mailbox has a history log for `history.list` that a test can expire. The Drive has files and a changes feed with page tokens that a test can expire (Drive then answers 400), and it answers only the `fields` a request names, failing the test if one asks for a file's name; the fake can answer 429s (retried as Nango's `Retries` header asks) and run a hook before each proxied request, to delete a connection under a running job. It can also delete a connection with no webhook (as Nango's bulk deletes do), or list nothing (an outage), for the nightly reconciliation. `src/testing/fake-inngest.ts` is Inngest Cloud's event API, the same way: it records the events the real Inngest client sends, and runs nothing. Tests never run Inngest; they call the `server.ts` function a job calls. A job passes its `step.run` to that function, which runs each step straight through when called without one.
- **Isolation tests:** `seedTwoOrgs()` from `src/db/testing/two-org-fixture.ts` seeds org A and org B, each with an admin and a member and a `ctx` for each. Each feature's `tests/isolation-cases.ts` passes `defineIsolationCases(server, { … })` a case for every `server.ts` export. `src/db/tests/isolation.test.ts` runs every case and fails, as does typecheck, when an export has none. It checks `server.ts` only, so `actions.ts` and `jobs.ts` stay thin and call `server.ts`. Mark a function that touches no org data `notTenantScoped("why")`.
- **Pre-commit (Husky + lint-staged):** Prettier and ESLint `--fix` on staged files, then typecheck. Tests stay out of the hook.
- **Pre-push:** `pnpm verify`.
- **CI:** the GitHub Actions workflow runs `pnpm verify` and nothing else (after installing dependencies and Playwright's Chromium), so a laptop and CI always check the same things.

## Naming

- Files: `kebab-case.ts`.
- Exports: named. Default exports only where Next.js requires them (`page.tsx`, `layout.tsx`, …).
- DB tables: `snake_case` plural (`workflow_versions`). TypeScript types: `PascalCase` singular (`WorkflowVersion`).
- Domain names: `GLOSSARY.md` terms, using the term itself rather than its listed _Avoid_ words (`Enablement`, not `Subscription`).
